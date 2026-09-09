import { readSession } from "../auth-session.mjs";
import { getOrder, listOrders } from "../order-store.mjs";

/**
 * A customer's own orders.
 *
 * Ownership comes from the signed session cookie and nothing else. The list is
 * filtered by the session's user id in the query itself, and a single order is
 * fetched by id and then checked against the same id before anything is
 * returned — so editing the id in the URL can only ever produce "not found".
 * Guest orders carry no user id and therefore belong to nobody: they are
 * unreachable here whoever asks.
 */

// `/api/orders/<id>` locally; Vercel rewrites it to `/api/orders?id=<id>`.
const orderIdOf = (request) => {
  const url = new URL(request.url || "/", "http://localhost");
  const path = url.pathname.startsWith("/api/orders/") ? url.pathname.slice("/api/orders/".length) : "";
  let fromPath = "";
  try { fromPath = decodeURIComponent(path); } catch { fromPath = ""; }
  return String(url.searchParams.get("id") || fromPath || "").trim();
};

const listedOrder = (order) => ({
  id: order.id,
  createdAt: order.createdAt,
  items: order.items,
  total: order.total,
});

// The detail view adds the contact the order was placed with — the customer's
// own name and number, never another account's.
const detailedOrder = (order) => ({
  ...listedOrder(order),
  customerName: order.customerName,
  customerPhone: order.customerPhone,
});

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  // A customer's history must never be held by a shared cache keyed on the URL.
  response.setHeader("Vary", "Cookie");

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

  const orderId = orderIdOf(request);

  try {
    if (orderId) {
      const order = await getOrder(orderId);
      // A guest order carries no user id, so it can never match a session.
      const owned = Boolean(order?.userId) && order.userId === session.id;
      // An order that is not this customer's answers exactly like one that does
      // not exist, so the endpoint cannot be used to discover order ids either.
      if (!order || !(owned || session.role === "admin")) {
        response.statusCode = 404;
        return response.end(JSON.stringify({ ok: false, message: "Buyurtma topilmadi." }));
      }
      response.statusCode = 200;
      return response.end(JSON.stringify({ ok: true, order: detailedOrder(order) }));
    }

    const orders = await listOrders(process.env, { userId: session.id, limit: 50 });
    response.statusCode = 200;
    return response.end(JSON.stringify({ ok: true, orders: orders.map(listedOrder) }));
  } catch (error) {
    console.error("Orders endpoint failed", error);
    response.statusCode = 500;
    return response.end(JSON.stringify({ ok: false, message: "Buyurtmalar tarixini yuklab bo‘lmadi." }));
  }
}
