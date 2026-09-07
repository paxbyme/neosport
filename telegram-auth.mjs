import { randomBytes, timingSafeEqual } from "node:crypto";
import { AuthError, normalizePhone } from "./auth-session.mjs";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

export const TELEGRAM_COOKIE = "ns_tg";
// Long enough to switch apps, share a contact and come back; short enough that
// an abandoned token is not a standing invitation.
export const LOGIN_TOKEN_MAX_AGE_MS = 10 * 60 * 1000;

const botToken = (environment) => {
  const token = String(environment.TELEGRAM_BOT_TOKEN || "");
  if (!token) throw new AuthError("Telegram orqali kirish hali sozlanmagan.", 503);
  return token;
};

export const isTelegramAuthConfigured = (environment = process.env) =>
  Boolean(environment.TELEGRAM_BOT_TOKEN) && Boolean(supabaseConfig(environment));

export const callTelegram = async (method, body, environment = process.env) => {
  // Resolved before the try, so a missing token reads as "not configured"
  // rather than being reported as a network failure.
  const url = `https://api.telegram.org/bot${botToken(environment)}/${method}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Telegram API request failed", method, error.message);
    throw new AuthError("Telegram bilan bog‘lanib bo‘lmadi.", 502);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    console.error("Telegram API rejected", method, response.status, JSON.stringify(result).slice(0, 300));
    throw new AuthError("Telegram so‘rovni rad etdi.", 502);
  }
  return result.result;
};

/* --------------------------------------------------------- login tokens -- */

const tokensConfig = (environment) => {
  const config = supabaseConfig(environment);
  if (!config) throw new AuthError("Kirish bazasi sozlanmagan.", 503);
  return config;
};

export const createLoginToken = async (nextPath, environment = process.env) => {
  const config = tokensConfig(environment);
  const token = randomBytes(24).toString("base64url");

  await supabaseRequest(config, "/rest/v1/login_tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ token, next_path: nextPath, status: "pending" }),
  });

  // Opportunistic cleanup: expired rows are useless and nothing else prunes them.
  const cutoff = new Date(Date.now() - LOGIN_TOKEN_MAX_AGE_MS).toISOString();
  supabaseRequest(config, `/rest/v1/login_tokens?created_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }).catch((error) => console.error("Expired login tokens could not be pruned", error.message));

  return token;
};

const readToken = async (token, environment) => {
  const config = tokensConfig(environment);
  const rows = await supabaseRequest(
    config,
    `/rest/v1/login_tokens?select=*&token=eq.${encodeURIComponent(token)}&limit=1`,
    { headers: { Accept: "application/json" } },
  );
  const row = rows?.[0];
  if (!row) return null;
  if (Date.parse(row.created_at) + LOGIN_TOKEN_MAX_AGE_MS < Date.now()) return null;
  return row;
};

export const findPendingToken = async (token, environment = process.env) => {
  const row = await readToken(token, environment);
  return row?.status === "pending" ? row : null;
};

/** Records which chat opened the deep link, so the contact that arrives in a
 * later webhook call — possibly on a different instance — can be matched to it. */
export const attachChatToToken = async (token, chatId, environment = process.env) => {
  const config = tokensConfig(environment);
  await supabaseRequest(config, `/rest/v1/login_tokens?token=eq.${encodeURIComponent(token)}&status=eq.pending`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ chat_id: String(chatId) }),
  });
};

export const findPendingTokenForChat = async (chatId, environment = process.env) => {
  const config = tokensConfig(environment);
  const rows = await supabaseRequest(
    config,
    `/rest/v1/login_tokens?select=*&chat_id=eq.${encodeURIComponent(String(chatId))}&status=eq.pending&order=created_at.desc&limit=1`,
    { headers: { Accept: "application/json" } },
  );
  const row = rows?.[0];
  if (!row || Date.parse(row.created_at) + LOGIN_TOKEN_MAX_AGE_MS < Date.now()) return null;
  return row;
};

export const markTokenVerified = async (token, { chatId, phone, name }, environment = process.env) => {
  const config = tokensConfig(environment);
  await supabaseRequest(config, `/rest/v1/login_tokens?token=eq.${encodeURIComponent(token)}&status=eq.pending`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "verified",
      chat_id: String(chatId),
      phone: normalizePhone(phone),
      full_name: String(name || "").slice(0, 80),
    }),
  });
};

/**
 * Turns a verified token into the user it represents, exactly once. The row is
 * marked used in the same filtered request, so two tabs racing on the same
 * token cannot both come away with a session.
 */
export const consumeVerifiedToken = async (token, environment = process.env) => {
  const config = tokensConfig(environment);
  const row = await readToken(token, environment);
  if (!row || row.status !== "verified") return null;

  const rows = await supabaseRequest(
    config,
    `/rest/v1/login_tokens?token=eq.${encodeURIComponent(token)}&status=eq.verified`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ status: "used" }),
    },
  );
  if (!rows || rows.length === 0) return null;

  const used = rows[0];
  return {
    user: {
      id: `tg:${used.chat_id}`,
      phone: normalizePhone(used.phone),
      name: used.full_name || "",
      email: "",
      picture: "",
    },
    next: used.next_path || "/",
  };
};

/* ------------------------------------------------------------- webhook --- */

export const verifyWebhookSecret = (request, environment = process.env) => {
  const expected = String(environment.TELEGRAM_WEBHOOK_SECRET || "");
  // Without a configured secret anyone who guesses the URL could forge a login.
  if (!expected) throw new AuthError("Telegram webhook siri sozlanmagan.", 503);

  const supplied = String(request?.headers?.["x-telegram-bot-api-secret-token"] || "");
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    throw new AuthError("Webhook siri mos kelmadi.", 401);
  }
};
