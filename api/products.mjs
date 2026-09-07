import { listProducts, ProductError } from "../product-service.mjs";

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    return response.end(JSON.stringify({ ok: false, message: "Faqat GET so‘rovi qabul qilinadi." }));
  }

  try {
    const products = await listProducts();
    response.statusCode = 200;
    return response.end(JSON.stringify({ ok: true, products }));
  } catch (error) {
    const status = error instanceof ProductError ? error.status : 500;
    if (status === 500) console.error("Products endpoint failed", error);
    response.statusCode = status;
    return response.end(JSON.stringify({ ok: false, message: "Mahsulotlarni yuklab bo‘lmadi." }));
  }
}
