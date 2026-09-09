import { getProduct, listProducts, ProductError } from "../product-service.mjs";

/**
 * The public catalog. `?id=<id>` answers with that one product, which is what
 * a product page loads: the page must render from its URL alone, without ever
 * fetching the whole catalog first.
 */
export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    return response.end(JSON.stringify({ ok: false, message: "Faqat GET so‘rovi qabul qilinadi." }));
  }

  const id = String(new URL(request.url || "/", "http://localhost").searchParams.get("id") || "").trim();

  try {
    if (id) {
      const product = await getProduct(id);
      // An inactive product is hidden from customers exactly like a missing one.
      if (!product || !product.active) {
        response.statusCode = 404;
        return response.end(JSON.stringify({ ok: false, message: "Mahsulot topilmadi." }));
      }
      response.statusCode = 200;
      return response.end(JSON.stringify({ ok: true, product }));
    }

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
