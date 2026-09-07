import { AuthError, clearCookie, createSessionCookie, OAUTH_COOKIE, readOAuthState, safeNextPath } from "../../auth-session.mjs";
import { exchangeCodeForUser } from "../../auth-service.mjs";

// The customer never sees a JSON error here: a failed sign-in sends them back to
// the page they started from, with a flag the page can turn into a message.
const back = (response, path, cookies) => {
  response.statusCode = 302;
  response.setHeader("Set-Cookie", cookies);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", path);
  response.end();
};

export default async function handler(request, response) {
  const url = new URL(request.url, "http://localhost");
  const dropOAuthCookie = clearCookie(OAUTH_COOKIE, { request });

  try {
    const state = readOAuthState(request);
    const code = url.searchParams.get("code");
    const next = safeNextPath(state?.next);

    // Supabase reports a refused consent screen through these parameters.
    if (url.searchParams.get("error")) {
      console.warn("Google sign-in was refused", url.searchParams.get("error"));
      return back(response, `${next}${next.includes("?") ? "&" : "?"}auth=bekor`, dropOAuthCookie);
    }

    // The verifier lives in an HttpOnly cookie this server set, so a callback
    // without it did not come from a sign-in we started.
    if (!code || !state) throw new AuthError("Kirish sessiyasi topilmadi. Qaytadan urinib ko‘ring.");

    const user = await exchangeCodeForUser(code, state.verifier);
    return back(response, next, [createSessionCookie(user, { request }), dropOAuthCookie]);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Auth callback failed", error);
    return back(response, "/?auth=xato", dropOAuthCookie);
  }
}
