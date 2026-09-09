import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import adminCategoriesHandler from "./api/admin/categories.mjs";
import adminCustomersHandler from "./api/admin/customers.mjs";
import adminProductsHandler from "./api/admin/products.mjs";
import adminStatsHandler from "./api/admin/stats.mjs";
import authHandler from "./api/auth.mjs";
import orderHandler from "./api/order.mjs";
import ordersHandler from "./api/orders.mjs";
import productsHandler from "./api/products.mjs";
import telegramWebhookHandler from "./api/telegram/webhook.mjs";
import { isPublicPreviewPath } from "./preview-static.mjs";

for (const filename of [".env.local", ".env"]) {
  if (!existsSync(filename)) continue;
  for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    // `vercel env pull` writes this for production secrets it may not reveal;
    // treating it as a value would hide the real one in a later file.
    if (value === "[SENSITIVE]") continue;
    process.env[match[1]] = value;
  }
}

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const readJsonBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 6 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname); }
  catch { response.writeHead(400); response.end("Noto‘g‘ri manzil."); return; }
  const apiHandler = {
    "/api/order": orderHandler,
    "/api/products": productsHandler,
    "/api/orders": ordersHandler,
    "/api/admin/categories": adminCategoriesHandler,
    "/api/admin/customers": adminCustomersHandler,
    "/api/admin/products": adminProductsHandler,
    "/api/admin/stats": adminStatsHandler,
    "/api/telegram/webhook": telegramWebhookHandler,
  }[pathname] || (pathname.startsWith("/api/auth/") ? authHandler : undefined);

  if (apiHandler) {
    try {
      if (["POST", "PUT", "PATCH"].includes(request.method)) request.body = await readJsonBody(request);
      await apiHandler(request, response);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(error instanceof SyntaxError ? 400 : 413, { "Content-Type": "application/json; charset=utf-8" });
      }
      if (!response.writableEnded) response.end(JSON.stringify({ ok: false, message: "Noto‘g‘ri so‘rov." }));
    }
    return;
  }

  if (!isPublicPreviewPath(pathname)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Sahifa topilmadi.");
    return;
  }
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const pageFile = {
    "/": "index.html",
    "/admin": "admin.html",
    "/admin/categories": "admin-categories.html",
    "/admin/products": "admin-products.html",
    "/admin/product": "admin-product.html",
    "/admin/customers": "admin-customers.html",
    "/shop": "shop.html",
  }[safePath];
  let filePath = join(root, pageFile || safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`NeoSport is running at http://localhost:${port}`);
});
