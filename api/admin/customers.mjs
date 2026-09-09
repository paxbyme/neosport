import { requireAdmin, AdminAuthError } from "../../admin-auth.mjs";
import { listCustomers } from "../../customer-service.mjs";

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  try {
    requireAdmin(request);

    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.statusCode = 405;
      return response.end(JSON.stringify({ ok: false, message: "Faqat GET so‘rovi qabul qilinadi." }));
    }

    const { customers, source, ordersAvailable } = await listCustomers();
    response.statusCode = 200;
    return response.end(JSON.stringify({ ok: true, customers, source, ordersAvailable }));
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 500;
    if (status === 500) console.error("Admin customers endpoint failed", error);
    response.statusCode = status;
    return response.end(
      JSON.stringify({ ok: false, message: status === 500 ? "Mijozlar ro‘yxatini yuklab bo‘lmadi." : error.message }),
    );
  }
}
