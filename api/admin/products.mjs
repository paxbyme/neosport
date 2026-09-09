import { requireAdmin, AdminAuthError } from "../../admin-auth.mjs";
import {
  createProduct,
  deleteProduct,
  listProducts,
  ProductError,
  setProductActive,
  updateProduct,
} from "../../product-service.mjs";

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
  try {
    await requireAdmin(request);

    if (request.method === "GET") {
      const products = await listProducts(process.env, { includeInactive: true });
      return sendJson(response, 200, { ok: true, products });
    }

    if (request.method === "POST") {
      const product = await createProduct(parseBody(request));
      return sendJson(response, 201, { ok: true, product });
    }

    if (request.method === "PATCH") {
      const id = new URL(request.url, "http://localhost").searchParams.get("id");
      const body = parseBody(request);
      // A body carrying nothing but `active` is the visibility toggle; anything
      // else is a full edit and goes through the same validation as a create.
      const product =
        Object.keys(body).length === 1 && typeof body.active === "boolean"
          ? await setProductActive(id, body.active)
          : await updateProduct(id, body);
      return sendJson(response, 200, { ok: true, product });
    }

    if (request.method === "DELETE") {
      const id = new URL(request.url, "http://localhost").searchParams.get("id");
      await deleteProduct(id);
      return sendJson(response, 200, { ok: true });
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(response, 405, { ok: false, message: "Bu amal qo‘llab-quvvatlanmaydi." });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(response, 400, { ok: false, message: "Noto‘g‘ri so‘rov." });
    const status = error instanceof AdminAuthError || error instanceof ProductError ? error.status : 500;
    if (status === 500) console.error("Admin products endpoint failed", error);
    return sendJson(response, status, { ok: false, message: status === 500 ? "Serverda xatolik yuz berdi." : error.message });
  }
}
