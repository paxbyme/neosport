import { clearCookie, safeNextPath, SESSION_COOKIE } from "../../auth-session.mjs";

export default function handler(request, response) {
  const next = safeNextPath(new URL(request.url, "http://localhost").searchParams.get("next"));

  response.statusCode = 302;
  response.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, { request }));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", next);
  response.end();
}
