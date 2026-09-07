import { AuthError, safeNextPath, serializeCookie } from "../../../auth-session.mjs";
import { callTelegram, createLoginToken, LOGIN_TOKEN_MAX_AGE_MS, TELEGRAM_COOKIE } from "../../../telegram-auth.mjs";

// Cached per warm instance: the username never changes and getMe is a round trip.
let cachedBotUsername = "";

const botUsername = async (environment) => {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await callTelegram("getMe", {}, environment);
  cachedBotUsername = String(me?.username || "");
  if (!cachedBotUsername) throw new AuthError("Telegram bot topilmadi.", 502);
  return cachedBotUsername;
};

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.statusCode = 405;
      return response.end("Faqat GET so‘rovi qabul qilinadi.");
    }

    const next = safeNextPath(new URL(request.url, "http://localhost").searchParams.get("next"));
    const [token, username] = await Promise.all([createLoginToken(next), botUsername(process.env)]);

    response.statusCode = 302;
    // The token travels to Telegram in the link and stays with this browser in
    // an HttpOnly cookie, so only the tab that started the flow can finish it.
    response.setHeader(
      "Set-Cookie",
      serializeCookie(TELEGRAM_COOKIE, token, { maxAge: Math.floor(LOGIN_TOKEN_MAX_AGE_MS / 1000), request }),
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Location", `https://t.me/${username}?start=${encodeURIComponent(token)}`);
    return response.end();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Telegram login start failed", error);
    response.statusCode = status;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end(status === 500 ? "Serverda xatolik yuz berdi." : error.message);
  }
}
