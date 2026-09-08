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
  serializeCookie,
  SESSION_COOKIE,
} from "./auth-session.mjs";
import { exchangeCodeForUser, googleAuthorizeUrl, isAuthConfigured } from "./auth-service.mjs";
import {
  callTelegram,
  consumeVerifiedToken,
  createLoginToken,
  isTelegramAuthConfigured,
  LOGIN_TOKEN_MAX_AGE_MS,
  TELEGRAM_COOKIE,
} from "./telegram-auth.mjs";

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

const logout = (request, response) =>
  redirect(response, safeNextPath(query(request).get("next")), clearCookie(SESSION_COOKIE, { request }));

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

// Cached per warm instance: the username never changes and getMe is a round trip.
let cachedBotUsername = "";

const botUsername = async (environment) => {
  if (cachedBotUsername) return cachedBotUsername;
  const bot = await callTelegram("getMe", {}, environment);
  cachedBotUsername = String(bot?.username || "");
  if (!cachedBotUsername) throw new AuthError("Telegram bot topilmadi.", 502);
  return cachedBotUsername;
};

const telegramStart = async (request, response) => {
  if (!requireGet(request, response)) return;

  const next = safeNextPath(query(request).get("next"));
  const [token, username] = await Promise.all([createLoginToken(next), botUsername(process.env)]);

  // The token travels to Telegram in the link and stays with this browser in an
  // HttpOnly cookie, so only the tab that started the flow can finish it.
  redirect(
    response,
    `https://t.me/${username}?start=${encodeURIComponent(token)}`,
    serializeCookie(TELEGRAM_COOKIE, token, {
      maxAge: Math.floor(LOGIN_TOKEN_MAX_AGE_MS / 1000),
      request,
    }),
  );
};

// Polled by the page the user left behind while they talked to the bot.
const telegramStatus = async (request, response) => {
  const token = parseCookies(request.headers.cookie)[TELEGRAM_COOKIE];
  if (!token) return sendJson(response, 200, { ok: true, ready: false, waiting: false });

  const result = await consumeVerifiedToken(token);
  if (!result) return sendJson(response, 200, { ok: true, ready: false, waiting: true });

  response.setHeader("Set-Cookie", [
    createSessionCookie(result.user, { request }),
    clearCookie(TELEGRAM_COOKIE, { request }),
  ]);
  return sendJson(response, 200, { ok: true, ready: true, next: result.next });
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
  }),
);
