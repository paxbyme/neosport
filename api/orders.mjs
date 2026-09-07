import { readSession } from "../auth-session.mjs";
import { listOrders } from "../order-store.mjs";

// A customer's own order history. Scoped by the session's user id, never by
// anything the browser sends.
export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    return response.end(JSON.stringify({ ok: false, message: "Faqat GET so‘rovi qabul qilinadi." }));
  }

  const session = readSession(request);
  if (!session) {
    response.statusCode = 401;
    return response.end(JSON.stringify({ ok: false, message: "Buyurtmalar tarixini ko‘rish uchun kiring." }));
  }

  try {
    const orders = await listOrders(process.env, { userId: session.id, limit: 50 });
    response.statusCode = 200;
    return response.end(
      JSON.stringify({
        ok: true,
        orders: orders.map((order) => ({
          id: order.id,
          createdAt: order.createdAt,
          items: order.items,
          total: order.total,
        })),
      }),
    );
  } catch (error) {
    console.error("Orders endpoint failed", error);
    response.statusCode = 500;
    return response.end(JSON.stringify({ ok: false, message: "Buyurtmalar tarixini yuklab bo‘lmadi." }));
  }
}
