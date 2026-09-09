// The development server runs beside credentials and server modules. Only
// browser assets and the isolated review artifacts may be served as files.
const publicPaths = new Set([
  "/admin/categories",
  "/admin/products",
  "/admin/product",
  "/admin/customers",
  "/admin/admins",
  "/admin-categories.html",
  "/admin-products.html",
  "/admin-product.html",
  "/admin-customers.html",
  "/admin-admins.html",
  "/admin-shell.js",
  "/admin-stats.js",
  "/admin-categories.js",
  "/admin-products.js",
  "/admin-product.js",
  "/admin-customers.js",
  "/admin-admins.js",
  "/", "/shop", "/admin", "/index.html", "/shop.html", "/admin.html", "/product.html",
  "/styles.css", "/landing.css", "/shop.css", "/admin.css", "/telegram-login.css",
  "/script.js", "/storefront-ui.js", "/telegram-login.js",
]);

// /products/<id> never reaches this gate: api/product-page.mjs answers it and
// reads the document itself, so only the plain file stays in the list above.
export const isPublicPreviewPath = pathname => {
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some(part => part.startsWith("."))) return false;
  return publicPaths.has(pathname) || pathname.startsWith("/assets/") || pathname.startsWith("/docs/ui-review/");
};
