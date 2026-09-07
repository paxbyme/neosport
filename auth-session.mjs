import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export const SESSION_COOKIE = "ns_session";
export const OAUTH_COOKIE = "ns_oauth";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
const OAUTH_MAX_AGE = 10 * 60;

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

const secretOf = (environment) => {
  const secret = String(environment.SESSION_SECRET || "");
  // Failing closed beats signing sessions with a guessable key.
  if (secret.length < 32) {
    throw new AuthError("Sessiya kaliti serverda sozlanmagan.", 503);
  }
  return secret;
};

const sign = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};

export const parseCookies = (header) => {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
};

// Secure cannot be set over plain http, or the browser drops the cookie and
// local development silently stops working.
const isSecureRequest = (request, environment) =>
  Boolean(environment.VERCEL) || String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0] === "https";

export const serializeCookie = (name, value, { maxAge, request, environment = process.env } = {}) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge ?? 0))}`,
  ];
  if (isSecureRequest(request, environment)) parts.push("Secure");
  return parts.join("; ");
};

export const clearCookie = (name, options) => serializeCookie(name, "", { ...options, maxAge: 0 });

export const createSessionCookie = (user, { request, environment = process.env } = {}) => {
  const secret = secretOf(environment);
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name || "",
      picture: user.picture || "",
      iat: now,
      exp: now + SESSION_MAX_AGE,
    }),
  );
  return serializeCookie(SESSION_COOKIE, `${payload}.${sign(payload, secret)}`, {
    maxAge: SESSION_MAX_AGE,
    request,
    environment,
  });
};

export const readSession = (request, environment = process.env) => {
  const token = parseCookies(request?.headers?.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;

  let secret;
  try {
    secret = secretOf(environment);
  } catch {
    return null;
  }
  if (!safeEqual(signature, sign(payload, secret))) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!claims?.sub || !claims?.email) return null;
  if (Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;

  return {
    id: claims.sub,
    email: String(claims.email).toLowerCase(),
    name: claims.name || "",
    picture: claims.picture || "",
    // The role is never taken from the cookie: removing an address from
    // ADMIN_EMAILS has to revoke access immediately, not when the session ends.
    role: isAdminEmail(claims.email, environment) ? "admin" : "customer",
  };
};

export const adminEmails = (environment = process.env) =>
  String(environment.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const isAdminEmail = (email, environment = process.env) => {
  const address = String(email || "").trim().toLowerCase();
  return Boolean(address) && adminEmails(environment).includes(address);
};

/* --------------------------------------------------------- the OAuth hop -- */

export const createOAuthState = ({ request, environment = process.env, next = "/" } = {}) => {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    cookie: serializeCookie(OAUTH_COOKIE, JSON.stringify({ verifier, next: safeNextPath(next) }), {
      maxAge: OAUTH_MAX_AGE,
      request,
      environment,
    }),
  };
};

export const readOAuthState = (request) => {
  const raw = parseCookies(request?.headers?.cookie)[OAUTH_COOKIE];
  if (!raw) return null;
  try {
    const state = JSON.parse(raw);
    return state?.verifier ? state : null;
  } catch {
    return null;
  }
};

// Only same-origin paths may be used as a post-login destination; anything else
// turns the login endpoint into an open redirect.
export const safeNextPath = (value) => {
  const path = String(value || "/");
  return /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/.test(path) ? path : "/";
};
