import { AuthError, clearCookie, createSessionCookie, parseCookies } from "../../../auth-session.mjs";
import { consumeVerifiedToken, TELEGRAM_COOKIE } from "../../../telegram-auth.mjs";

// Polled by the page the user left behind while they talked to the bot.
export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  const token = parseCookies(request.headers.cookie)[TELEGRAM_COOKIE];
  if (!token) {
    response.statusCode = 200;
    return response.end(JSON.stringify({ ok: true, ready: false, waiting: false }));
  }

  try {
    const result = await consumeVerifiedToken(token);
    if (!result) {
      response.statusCode = 200;
      return response.end(JSON.stringify({ ok: true, ready: false, waiting: true }));
    }

    response.statusCode = 200;
    response.setHeader("Set-Cookie", [
      createSessionCookie(result.user, { request }),
      clearCookie(TELEGRAM_COOKIE, { request }),
    ]);
    return response.end(JSON.stringify({ ok: true, ready: true, next: result.next }));
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Telegram login status failed", error);
    response.statusCode = status;
    return response.end(
      JSON.stringify({ ok: false, message: status === 500 ? "Serverda xatolik yuz berdi." : error.message }),
    );
  }
}
