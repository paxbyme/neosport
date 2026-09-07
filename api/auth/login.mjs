import { AuthError, createOAuthState, safeNextPath } from "../../auth-session.mjs";
import { googleAuthorizeUrl } from "../../auth-service.mjs";

export default function handler(request, response) {
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.statusCode = 405;
      return response.end("Faqat GET so‘rovi qabul qilinadi.");
    }

    const next = safeNextPath(new URL(request.url, "http://localhost").searchParams.get("next"));
    const { verifier, cookie } = createOAuthState({ request, next });

    response.statusCode = 302;
    response.setHeader("Set-Cookie", cookie);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Location", googleAuthorizeUrl({ verifier, request }));
    return response.end();
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Login endpoint failed", error);
    response.statusCode = status;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end(status === 500 ? "Serverda xatolik yuz berdi." : error.message);
  }
}
