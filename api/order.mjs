import { readSession } from "../auth-session.mjs";
import { createTelegramOrder, enforceOrderRateLimit, OrderError } from "../order-service.mjs";
import { clientAddress } from "../rate-limit.mjs";

const sendJson = (response, status, body) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
};

const parseBody = (request) => {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);
  return {};
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { ok: false, message: "Faqat POST so‘rovi qabul qilinadi." });
  }

  try {
    enforceOrderRateLimit(clientAddress(request));
    // Signing in is optional: a guest order simply carries no account.
    const result = await createTelegramOrder(parseBody(request), process.env, readSession(request));
    return sendJson(response, 201, { ok: true, ...result });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(response, 400, { ok: false, message: "Noto‘g‘ri so‘rov." });
    const status = error instanceof OrderError ? error.status : 500;
    if (status === 500) console.error("Order endpoint failed", error);
    return sendJson(response, status, { ok: false, message: status === 500 ? "Serverda xatolik yuz berdi." : error.message });
  }
}
