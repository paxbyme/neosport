import { requireAdmin, AdminAuthError } from "../../admin-auth.mjs";
import { ProductError } from "../../product-service.mjs";
import { buildStats } from "../../stats-service.mjs";

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  try {
    await requireAdmin(request);

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.statusCode = 405;
      return response.end(JSON.stringify({ ok: false, message: "Faqat GET so‘rovi qabul qilinadi." }));
    }

    const stats = await buildStats();
    response.statusCode = 200;
    return response.end(JSON.stringify({ ok: true, stats }));
  } catch (error) {
    const status = error instanceof AdminAuthError || error instanceof ProductError ? error.status : 500;
    if (status === 500) console.error("Admin stats endpoint failed", error);
    response.statusCode = status;
    return response.end(
      JSON.stringify({ ok: false, message: status === 500 ? "Statistikani yuklab bo‘lmadi." : error.message }),
    );
  }
}
