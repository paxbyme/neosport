import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProduct, ProductError } from "../product-service.mjs";

/**
 * Serves /products/<id>.
 *
 * The page itself renders in the browser, but the sharing metadata cannot: a
 * Telegram link preview and an Instagram crawler never run the script, so a
 * shared product would otherwise preview as the generic shop. This fills the
 * head in on the server and hands the same document to the browser, which then
 * renders the product from its own request as before.
 */

/**
 * The document travels with the function through `functions.includeFiles` in
 * vercel.json. Where it lands depends on how the bundle is laid out, so both
 * the path beside this module and the deployment root are tried; reading it
 * lazily means a packaging mistake surfaces as one logged request rather than
 * as an instance that cannot start at all.
 */
const candidates = [new URL("../product.html", import.meta.url), join(process.cwd(), "product.html")];
let cached = "";

const pageDocument = () => {
  // Read once per instance rather than per request; Fluid Compute reuses these.
  if (cached) return cached;
  for (const candidate of candidates) {
    try {
      cached = readFileSync(candidate, "utf8");
      return cached;
    } catch { /* Try the next layout. */ }
  }
  throw new Error(`product.html was not found beside the function (${candidates.join(", ")})`);
};

export const PRODUCT_PATH = /^\/products\/([A-Za-z0-9-]{3,80})$/;

// The path locally, the rewritten query on Vercel.
export const productIdOf = (url) => {
  let parsed;
  try { parsed = new URL(url || "/", "http://localhost"); } catch { return ""; }
  let path = "";
  try { path = decodeURIComponent(parsed.pathname); } catch { path = ""; }
  return String(parsed.searchParams.get("id") || PRODUCT_PATH.exec(path)?.[1] || "").trim();
};

const escapeAttribute = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const formatMoney = (amount) => `${new Intl.NumberFormat("uz-UZ").format(amount)} so‘m`;

// SITE_URL is the configured address; behind a proxy the request still knows
// which host answered, and a crawler needs whole addresses either way.
const originOf = (request, environment) => {
  const configured = String(environment.SITE_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = String(request.headers?.host || "");
  const proto = String(request.headers?.["x-forwarded-proto"] || "").split(",")[0] || (environment.VERCEL ? "https" : "http");
  return host ? `${proto}://${host}` : "";
};

const describe = (product) => {
  const details = product.description || `${product.brand} · ${product.category}`;
  // Price first: it is the one thing a shared shop link should show at a glance.
  return `${formatMoney(product.finalPrice)} · ${details}`;
};

const render = (template, product, origin) => {
  const title = `${product.name} — NeoSport`;
  const address = `${origin}/products/${encodeURIComponent(product.id)}`;
  const image = /^https?:\/\//i.test(product.imageUrl) ? product.imageUrl : `${origin}${product.imageUrl}`;

  // Each pattern is anchored on a tag that appears once in the document, so a
  // head that changes shape fails to match rather than replacing the wrong tag.
  const replacements = [
    [/(<meta name="description" content=")[^"]*(")/, describe(product)],
    [/(<meta property="og:title" content=")[^"]*(")/, title],
    [/(<meta property="og:description" content=")[^"]*(")/, describe(product)],
    [/(<meta property="og:image" content=")[^"]*(")/, image],
    [/(<meta property="og:url" content=")[^"]*(")/, address],
    [/(<link rel="canonical" href=")[^"]*(")/, address],
    [/(<title>)[^<]*(<\/title>)/, title],
  ];

  return replacements.reduce(
    (html, [pattern, value]) => html.replace(pattern, `$1${escapeAttribute(value)}$2`),
    template,
  );
};

const send = (response, status, html) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  // The document holds nothing about the visitor, so a shared cache may keep it.
  response.setHeader("Cache-Control", status === 200 ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300" : "no-store");
  response.end(html);
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Faqat GET so‘rovi qabul qilinadi.");
  }

  let template;
  try {
    template = pageDocument();
  } catch (error) {
    // Only a packaging mistake reaches this, and there is no page to fall back
    // to: everything below needs the document.
    console.error("Product page document is missing", error.message);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Sahifani ko‘rsatib bo‘lmadi.");
  }

  const id = productIdOf(request.url);

  try {
    const product = id ? await getProduct(id) : null;
    // A product that was never there, or was taken out of the catalog, is a
    // 404 for crawlers; the browser still gets the page and shows why.
    if (!product || !product.active) return send(response, 404, template);
    return send(response, 200, render(template, product, originOf(request, process.env)));
  } catch (error) {
    if (!(error instanceof ProductError)) console.error("Product page failed", error);
    // The catalog being unreachable must not cost the customer the page: the
    // script retries the product request on its own.
    return send(response, 200, template);
  }
}
