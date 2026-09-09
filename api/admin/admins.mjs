import { requireAdmin, AdminAuthError } from "../../admin-auth.mjs";
import { addAdmin, AdminError, listAdmins, removeAdmin } from "../../admin-service.mjs";

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

// Who a change is recorded against, and who may not remove themselves. The
// legacy password path has no identity, so it is named rather than matched.
const actor = (session) => (session.legacy ? "parol" : session.email || session.phone || session.name || "");

export default async function handler(request, response) {
  try {
    const session = await requireAdmin(request);

    if (request.method === "GET") {
      return sendJson(response, 200, { ok: true, admins: await listAdmins(), you: actor(session) });
    }

    if (request.method === "POST") {
      const admin = await addAdmin(parseBody(request), actor(session));
      return sendJson(response, 201, { ok: true, admin });
    }

    if (request.method === "DELETE") {
      // A password session has no identity of its own, so it cannot be the
      // account being removed and needs no self-removal check.
      const admin = await removeAdmin(idFrom(request), session.legacy ? null : session);
      return sendJson(response, 200, { ok: true, admin });
    }

    response.setHeader("Allow", "GET, POST, DELETE");
    return sendJson(response, 405, { ok: false, message: "Bu so‘rov qo‘llab-quvvatlanmaydi." });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(response, 400, { ok: false, message: "Noto‘g‘ri so‘rov." });
    const status = error instanceof AdminAuthError || error instanceof AdminError ? error.status : 500;
    if (status === 500) console.error("Admin admins endpoint failed", error);
    return sendJson(response, status, {
      ok: false,
      message: status === 500 ? "Adminlar ro‘yxatini o‘zgartirib bo‘lmadi." : error.message,
    });
  }
}
