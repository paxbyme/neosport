/**
 * Every /api/auth/* handler, in one module.
 *
 * They live here rather than under api/ because Vercel deploys one Serverless
 * Function per file in that directory, and the Hobby plan allows twelve. Six
 * endpoints that are barely forty lines each are not worth six of them, so
 * api/auth.mjs dispatches to these.
 */
import {
  AuthError,
  clearCookie,
  createOAuthState,
  createSessionCookie,
  OAUTH_COOKIE,
  parseCookies,
  readOAuthState,
  readSession,
  safeNextPath,
  SESSION_COOKIE,
} from "./auth-session.mjs";
import { exchangeCodeForUser, googleAuthorizeUrl, isAuthConfigured } from "./auth-service.mjs";
import {
  callTelegram,
  cancelLoginToken,
  consumeVerifiedToken,
  createLoginToken,
  createTelegramCookie,
  isTelegramAuthConfigured,
  LOGIN_TOKEN_MAX_AGE_MS,
  loginTokenStatus,
  readTelegramToken,
  TELEGRAM_COOKIE,
} from "./telegram-auth.mjs";
import { checkRateLimit, clientAddress } from "./rate-limit.mjs";

const query = (request) => new URL(request.url, "http://localhost").searchParams;

const sendJson = (response, status, body) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
};

const redirect = (response, location, cookies) => {
  response.statusCode = 302;
  if (cookies) response.setHeader("Set-Cookie", cookies);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", location);
  response.end();
};

const requireGet = (request, response) => {
  if (request.method === "GET") return true;
  response.setHeader("Allow", "GET");
  response.statusCode = 405;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Faqat GET so‘rovi qabul qilinadi.");
  return false;
};

/* ------------------------------------------------------------- Google --- */

const login = (request, response) => {
  if (!requireGet(request, response)) return;

  const next = safeNextPath(query(request).get("next"));
  const { verifier, cookie } = createOAuthState({ request, next });
  redirect(response, googleAuthorizeUrl({ verifier, request }), cookie);
};

const callback = async (request, response) => {
  const parameters = query(request);
  const dropOAuthCookie = clearCookie(OAUTH_COOKIE, { request });

  try {
    const state = readOAuthState(request);
    const code = parameters.get("code");
    const next = safeNextPath(state?.next);

    // Supabase reports a refused consent screen through these parameters.
    if (parameters.get("error")) {
      console.warn("Google sign-in was refused", parameters.get("error"));
      return redirect(response, `${next}${next.includes("?") ? "&" : "?"}auth=bekor`, dropOAuthCookie);
    }

    // The verifier lives in an HttpOnly cookie this server set, so a callback
    // without it did not come from a sign-in we started.
    if (!code || !state) throw new AuthError("Kirish sessiyasi topilmadi. Qaytadan urinib ko‘ring.");

    const user = await exchangeCodeForUser(code, state.verifier);
    return redirect(response, next, [createSessionCookie(user, { request }), dropOAuthCookie]);
  } catch (error) {
    if (!(error instanceof AuthError)) console.error("Auth callback failed", error);
    // The customer never sees a JSON error here: a failed sign-in sends them
    // back to the site with a flag the page turns into a message.
    return redirect(response, "/?auth=xato", dropOAuthCookie);
  }
};

const logout = async (request, response) => {
  if (!requireGet(request, response)) return;
  const token = readTelegramToken(request);
  await cancelLoginToken(token).catch(() => {});
  redirect(response, safeNextPath(query(request).get("next")), [clearCookie(SESSION_COOKIE, { request }), clearCookie(TELEGRAM_COOKIE, { request })]);
};

const me = (request, response) => {
  const session = readSession(request);
  sendJson(response, 200, {
    ok: true,
    // The pages only show a button for a method that is actually configured.
    googleEnabled: isAuthConfigured(),
    telegramEnabled: isTelegramAuthConfigured(),
    user: session && {
      email: session.email,
      phone: session.phone,
      name: session.name,
      picture: session.picture,
      role: session.role,
    },
  });
};

/* ----------------------------------------------------------- Telegram --- */

// Short-lived cache follows the configured token and tolerates bot renaming.
let cachedBot = null;

const botUsername = async (environment) => {
  if (cachedBot?.token === environment.TELEGRAM_BOT_TOKEN && cachedBot.expiresAt > Date.now()) return cachedBot.username;
  const bot = await callTelegram("getMe", {}, environment);
  const username = String(bot?.username || "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new AuthError("Telegram bot topilmadi.", 502);
  cachedBot = { token: environment.TELEGRAM_BOT_TOKEN, username, expiresAt: Date.now() + 5 * 60 * 1000 };
  return username;
};

const telegramStart = async (request, response) => {
  if (!requireGet(request, response)) return;
  if (!isTelegramAuthConfigured()) throw new AuthError("Telegram orqali kirish hali sozlanmagan.", 503);
  if (!checkRateLimit("telegram-login", clientAddress(request), { max: 10, windowMs: 10 * 60 * 1000 })) {
    response.setHeader("Retry-After", "600");
    throw new AuthError("Ko‘p urinish bo‘ldi. Birozdan keyin qayta urinib ko‘ring.", 429);
  }

  const next = safeNextPath(query(request).get("next"));
  // Resolve the bot before creating a database row, then retire this browser's
  // previous attempt so a retry cannot later complete an abandoned sign-in.
  const username = await botUsername(process.env);
  await cancelLoginToken(readTelegramToken(request));
  const token = await createLoginToken(next);
  const cookie = createTelegramCookie(token, { request });
  const url = `https://t.me/${username}?start=${encodeURIComponent(token)}`;
  if (String(request.headers.accept || "").includes("application/json")) {
    response.setHeader("Set-Cookie", cookie);
    return sendJson(response, 200, { ok: true, url, expiresIn: LOGIN_TOKEN_MAX_AGE_MS / 1000 });
  }

  // The token travels to Telegram in the link and stays with this browser in an
  // HttpOnly cookie, so only the tab that started the flow can finish it.
  redirect(
    response,
    url,
    cookie,
  );
};

// Polled by the page the user left behind while they talked to the bot.
const telegramStatus = async (request, response) => {
  if (!requireGet(request, response)) return;
  const token = readTelegramToken(request);
  if (!token) {
    const invalid = Boolean(parseCookies(request.headers.cookie)[TELEGRAM_COOKIE]);
    if (invalid) response.setHeader("Set-Cookie", clearCookie(TELEGRAM_COOKIE, { request }));
    return sendJson(response, 200, { ok: true, ready: false, waiting: false, state: invalid ? "expired" : "idle" });
  }
  if (!isTelegramAuthConfigured()) throw new AuthError("Telegram orqali kirish hali sozlanmagan.", 503);

  const result = await consumeVerifiedToken(token);
  if (!result) {
    const status = await loginTokenStatus(token);
    const waiting = ["pending", "verified"].includes(status.state);
    if (!waiting) response.setHeader("Set-Cookie", clearCookie(TELEGRAM_COOKIE, { request }));
    return sendJson(response, 200, { ok: true, ready: false, waiting, ...status });
  }

  response.setHeader("Set-Cookie", [
    createSessionCookie(result.user, { request }),
    clearCookie(TELEGRAM_COOKIE, { request }),
  ]);
  return sendJson(response, 200, { ok: true, ready: true, state: "ready", next: safeNextPath(result.next) });
};

const telegramCancel = async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { ok: false, message: "Faqat POST so‘rovi qabul qilinadi." });
  }
  // A JSON-only request cannot be forged with a cross-site HTML form.
  if (!String(request.headers["content-type"] || "").startsWith("application/json") || request.headers["sec-fetch-site"] === "cross-site") {
    throw new AuthError("Noto‘g‘ri so‘rov.", 403);
  }
  await cancelLoginToken(readTelegramToken(request));
  response.setHeader("Set-Cookie", clearCookie(TELEGRAM_COOKIE, { request }));
  return sendJson(response, 200, { ok: true, state: "cancelled" });
};

// A null prototype means an action named "constructor" or "__proto__" cannot
// resolve to an inherited function, whatever the caller does with it.
export const authRoutes = Object.freeze(
  Object.assign(Object.create(null), {
    login,
    callback,
    logout,
    me,
    "telegram/start": telegramStart,
    "telegram/status": telegramStatus,
    "telegram/cancel": telegramCancel,
  }),
);
