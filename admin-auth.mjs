import { timingSafeEqual } from "node:crypto";
import { isStoredAdmin } from "./admin-service.mjs";
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
 * Admin access comes from a session whose email is in ADMIN_EMAILS, whose
 * phone is in ADMIN_PHONES, or which the panel's own admins list names.
 *
 * The environment is checked first and without touching the database, so the
 * recovery path keeps working when the database does not, and so a request
 * that is already an admin never pays for the lookup. ADMIN_PASSWORD stays as
 * a fallback for local work and for the window before sign-in is configured;
 * leaving it unset disables that path entirely.
 */
export const requireAdmin = async (request, environment = process.env) => {
  const session = readSession(request, environment);
  if (session?.role === "admin") return session;

  const password = String(environment.ADMIN_PASSWORD || "");

  if (session) {
    // A database that cannot be reached must not silently demote an admin, so
    // the failure is reported rather than answered as "not an admin".
    let granted;
    try {
      granted = await isStoredAdmin(session, environment);
    } catch (error) {
      console.error("Admin list could not be read", error.message);
      throw new AdminAuthError("Adminlar ro‘yxatini tekshirib bo‘lmadi. Birozdan keyin urinib ko‘ring.", 503);
    }
    if (granted) return { ...session, role: "admin" };

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
