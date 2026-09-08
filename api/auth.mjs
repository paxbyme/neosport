import { AuthError } from "../auth-session.mjs";
import { authRoutes } from "../auth-routes.mjs";

/**
 * Single entry point for /api/auth/*. A vercel.json rewrite sends every path
 * under it here with `?action=<rest of the path>`, so six endpoints cost one
 * Serverless Function instead of six.
 */
export const resolveAction = (request) => {
  const url = new URL(request.url, "http://localhost");
  const fromQuery = url.searchParams.get("action");
  if (fromQuery) return fromQuery.replace(/^\/+|\/+$/g, "");
  // Direct hits (and the local dev server) still carry the real path.
  return url.pathname.replace(/^\/api\/auth\/?/, "").replace(/\/+$/, "");
};

export default async function handler(request, response) {
  const action = resolveAction(request);
  const route = Object.hasOwn(authRoutes, action) ? authRoutes[action] : null;

  if (!route) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.end(JSON.stringify({ ok: false, message: "Bunday manzil yo‘q." }));
  }

  try {
    return await route(request, response);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Auth endpoint failed", action, error);
    if (response.headersSent) return undefined;

    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    return response.end(
      JSON.stringify({ ok: false, message: status === 500 ? "Serverda xatolik yuz berdi." : error.message }),
    );
  }
}
