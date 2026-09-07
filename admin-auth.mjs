import { timingSafeEqual } from "node:crypto";
import { readSession } from "./auth-session.mjs";
import { checkRateLimit, clientAddress } from "./rate-limit.mjs";

export class AdminAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

// Ten failed attempts per address per 15 minutes. Successful requests are not
// counted, so working in the panel never locks you out of it.
const ATTEMPT_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

const passwordMatches = (authorization, expected) => {
  const supplied = String(authorization || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
};

/**
 * Admin access comes from a Google session whose email is in ADMIN_EMAILS.
 * ADMIN_PASSWORD stays as a fallback for local work and for the window before
 * Google sign-in is configured; leaving it unset disables that path entirely.
 */
export const requireAdmin = (request, environment = process.env) => {
  const session = readSession(request, environment);
  if (session?.role === "admin") return session;

  const password = String(environment.ADMIN_PASSWORD || "");

  if (session) {
    // Signed in, but not as an admin: no point counting this against the
    // brute-force budget, and the message should say what is actually wrong.
    throw new AdminAuthError("Bu hisobda admin huquqi yo‘q.", 403);
  }

  if (!password) {
    throw new AdminAuthError("Admin kirish sozlanmagan. Google orqali kiring.", 401);
  }

  if (!checkRateLimit("admin-auth", clientAddress(request), ATTEMPT_LIMIT)) {
    throw new AdminAuthError("Juda ko‘p urinish bo‘ldi. 15 daqiqadan keyin qayta urinib ko‘ring.", 429);
  }

  if (!passwordMatches(request?.headers?.authorization, password)) {
    throw new AdminAuthError("Parol noto‘g‘ri.");
  }

  return { email: "", name: "Admin", role: "admin", legacy: true };
};
