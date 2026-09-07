import { createHash } from "node:crypto";
import { AuthError } from "./auth-session.mjs";

// The browser talks to us, never to Supabase directly, so the anon key stays on
// the server too. It is not a secret, but there is no reason to ship it.
const authConfig = (environment) => {
  const url = String(environment.SUPABASE_URL || environment.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = String(environment.SUPABASE_ANON_KEY || environment.PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !anonKey) {
    throw new AuthError("Google orqali kirish hali sozlanmagan.", 503);
  }
  return { url, anonKey };
};

export const isAuthConfigured = (environment = process.env) => {
  try {
    authConfig(environment);
    return true;
  } catch {
    return false;
  }
};

const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");

// Supabase needs an absolute callback, and it must match one of the redirect
// URLs allow-listed in the dashboard.
export const callbackUrl = (request, environment = process.env) => {
  const configured = String(environment.SITE_URL || "").replace(/\/$/, "");
  if (configured) return `${configured}/api/auth/callback`;

  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0];
  const protocol = forwardedProto || (environment.VERCEL ? "https" : "http");
  const host = String(request?.headers?.["x-forwarded-host"] || request?.headers?.host || "localhost");
  return `${protocol}://${host}/api/auth/callback`;
};

// No `state` is sent: Supabase generates and validates its own for the PKCE
// flow, and passing ours made it reject the callback with bad_oauth_state.
// CSRF protection comes from the HttpOnly cookie holding the code verifier.
export const googleAuthorizeUrl = ({ verifier, request, environment = process.env }) => {
  const { url } = authConfig(environment);
  const parameters = new URLSearchParams({
    provider: "google",
    redirect_to: callbackUrl(request, environment),
    code_challenge: challengeOf(verifier),
    code_challenge_method: "s256",
  });
  return `${url}/auth/v1/authorize?${parameters}`;
};

const readUser = (payload) => {
  const user = payload?.user;
  const email = String(user?.email || "").trim().toLowerCase();
  if (!user?.id || !email) throw new AuthError("Google hisobidan email olinmadi.", 502);

  const metadata = user.user_metadata || {};
  return {
    id: String(user.id),
    email,
    name: String(metadata.full_name || metadata.name || email.split("@")[0]).slice(0, 80),
    picture: /^https:\/\//i.test(String(metadata.avatar_url || metadata.picture || ""))
      ? String(metadata.avatar_url || metadata.picture)
      : "",
  };
};

export const exchangeCodeForUser = async (code, verifier, environment = process.env) => {
  const { url, anonKey } = authConfig(environment);

  let response;
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Supabase token exchange failed", error.message);
    throw new AuthError("Google bilan bog‘lanib bo‘lmadi. Qayta urinib ko‘ring.", 502);
  }

  if (!response.ok) {
    const details = await response.text();
    console.error("Supabase rejected the auth code", response.status, details.slice(0, 500));
    throw new AuthError("Kirish tasdiqlanmadi. Qayta urinib ko‘ring.", 401);
  }

  return readUser(await response.json());
};
