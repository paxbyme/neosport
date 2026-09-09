import { requireAdmin, AdminAuthError } from "../../admin-auth.mjs";
import {
  CategoryError,
  createCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  setCategoryActive,
  updateCategory,
} from "../../category-service.mjs";

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

const idFrom = (request) => new URL(request.url, "http://localhost").searchParams.get("id");

export default async function handler(request, response) {
  try {
    await requireAdmin(request);

    if (request.method === "GET") {
      const categories = await listCategories(process.env, { includeInactive: true });
      return sendJson(response, 200, { ok: true, categories });
    }

    if (request.method === "POST") {
      const category = await createCategory(parseBody(request));
      return sendJson(response, 201, { ok: true, category });
    }

    if (request.method === "PATCH") {
      const id = idFrom(request);
      const body = parseBody(request);

      // Three shapes share this route: a visibility toggle, a reorder step and
      // a full edit — the same split the products endpoint uses.
      if (Object.keys(body).length === 1 && typeof body.active === "boolean") {
        const category = await setCategoryActive(id, body.active);
        return sendJson(response, 200, { ok: true, category });
      }
      if (Object.keys(body).length === 1 && typeof body.move === "string") {
        const categories = await moveCategory(id, body.move);
        return sendJson(response, 200, { ok: true, categories });
      }

      const category = await updateCategory(id, body);
      return sendJson(response, 200, { ok: true, category });
    }

    if (request.method === "DELETE") {
      await deleteCategory(idFrom(request));
      return sendJson(response, 200, { ok: true });
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(response, 405, { ok: false, message: "Bu amal qo‘llab-quvvatlanmaydi." });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(response, 400, { ok: false, message: "Noto‘g‘ri so‘rov." });
    const status = error instanceof AdminAuthError || error instanceof CategoryError ? error.status : 500;
    if (status === 500) console.error("Admin categories endpoint failed", error);
    return sendJson(response, status, { ok: false, message: status === 500 ? "Serverda xatolik yuz berdi." : error.message });
  }
}
