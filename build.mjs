import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const output = join(root, "dist");
const files = [
  "index.html",
  "shop.html",
  "styles.css",
  "landing.css",
  "shop.css",
  "script.js",
  "storefront-ui.js",
  "telegram-login.js",
  "telegram-login.css",
  "admin.html",
  "admin.css",
  "admin-categories.html",
  "admin-products.html",
  "admin-product.html",
  "admin-customers.html",
  "admin-shell.js",
  "admin-stats.js",
  "admin-categories.js",
  "admin-products.js",
  "admin-product.js",
  "admin-customers.js",
];
const assets = ["neosport-hero.png", "neosport-hero.webp", "neosport-mark.png", "neosport-mark.webp", "icons.svg", "lucide-LICENSE"];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
mkdirSync(join(output, "assets"), { recursive: true });

for (const file of files) {
  cpSync(join(root, file), join(output, file));
}

for (const asset of assets) {
  cpSync(join(root, "assets", asset), join(output, "assets", asset));
}

console.log(`Static production build created in ${output}`);
