import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { requireAdmin } from "../admin-auth.mjs";
import { isPublicPreviewPath } from "../preview-static.mjs";
import { PRODUCT_PATH } from "../api/product-page.mjs";
import { createTelegramOrder } from "../order-service.mjs";
import { createCategory, deleteCategory, updateCategory } from "../category-service.mjs";
import { createProduct, effectivePrice, MAX_DISCOUNT_PERCENT, MAX_IMAGES, updateProduct } from "../product-service.mjs";
import { buildStats } from "../stats-service.mjs";
import {
  createSessionCookie,
  isAdminEmail,
  isAdminPhone,
  normalizePhone,
  readSession,
  safeNextPath,
  SESSION_COOKIE,
} from "../auth-session.mjs";
import { callTelegram, isTelegramAuthConfigured, verifyWebhookSecret } from "../telegram-auth.mjs";
import { callbackUrl, googleAuthorizeUrl, isAuthConfigured } from "../auth-service.mjs";
import { resetRateLimits } from "../rate-limit.mjs";
import { supabaseRequest } from "../supabase.mjs";
import { listCustomers } from "../customer-service.mjs";
import { registerTelegramUser, telegramUserId } from "../user-service.mjs";

const fakeRequest = (headers = {}) => ({ headers, socket: { remoteAddress: "203.0.113.7" } });

// Turns a Set-Cookie string back into the Cookie header a browser would send.
const asCookieHeader = (setCookie) => setCookie.split(";")[0];

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const html = read("index.html");
const shopHtml = read("shop.html");
const productHtml = read("product.html");
const css = read("styles.css");
const landingCss = read("landing.css");
const shopCss = read("shop.css");
const script = read("script.js");
const storefrontUi = read("storefront-ui.js");
const instagram = "https://www.instagram.com/neosport_namangan/";
const maps = "https://yandex.uz/maps/-/CTgRbPmH";

test("page keeps the required sections and unique IDs", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.deepEqual(duplicates, []);
  for (const id of ["main", "top", "hero-title", "new", "collection", "about", "store"]) {
    assert.ok(ids.includes(id), `missing #${id}`);
  }
});

test("hero prioritizes the separate shop and retains collection browsing", () => {
  const heroActions = html.match(/<div class="hero-actions">[\s\S]*?<\/div>/)?.[0] ?? "";

  assert.match(heroActions, /class="button button-primary" href="\/shop"/);
  assert.match(heroActions, /class="button button-ghost" href="#collection"/);
  assert.ok(heroActions.indexOf("button-primary") < heroActions.indexOf("button-ghost"));
  assert.match(html, /class="cart-toggle"/);
});

test("the landing page ships no hardcoded products", () => {
  assert.equal([...html.matchAll(/<a\s+class="card"[\s\S]*?<\/a>/g)].length, 0);
  assert.doesNotMatch(html, /assets\/products\//);

  // A placeholder holds the grid's place until the catalog is filled again.
  assert.match(html, /class="row-empty"/);
  assert.match(landingCss, /\.row-empty \{/);

  // No Product structured data while the store lists nothing.
  assert.doesNotMatch(html, /"@type": "Product"/);

  // The sprite of models is gone from the landing page entirely.
  assert.doesNotMatch(html + landingCss, /neosport-categories/);
});

test("the three category tiles link out and carry no product photography", () => {
  const tiles = [...html.matchAll(/<a\s+class="tile"[\s\S]*?<\/a>/g)].map((match) => match[0]);
  assert.equal(tiles.length, 3);

  for (const tile of tiles) {
    assert.match(tile, new RegExp(`href="${instagram}"`));
    assert.match(tile, /aria-label="/);
    assert.match(tile, /<h3>/);
    // The cut-out product shots are gone, so the tiles are label-only.
    assert.doesNotMatch(tile, /<img|<picture/);
  }

  assert.doesNotMatch(landingCss, /\.tile img/);

  // Football kit is not stocked, so no lane claims it.
  assert.doesNotMatch(html, /FUTBOL|Futbol kiyimlari/);
});

test("buttons are flat rectangles with no decorative arrow", () => {
  // [^}]* keeps each assertion inside its own rule block.
  assert.match(css, /\.button \{[^}]*justify-content: center;/);
  assert.doesNotMatch(css, /\.button \{[^}]*border-radius/);
  assert.doesNotMatch(css, /\.button:hover \{[^}]*translateY/);

  for (const button of html.matchAll(/<a class="button[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    assert.doesNotMatch(button[1], /[→↗↓]/, `decorative arrow in button: ${button[1].trim()}`);
  }
});

test("numbering appears only on the ordered buying steps", () => {
  const main = html.match(/<main id="main">[\s\S]*?<\/main>/)?.[0] ?? "";

  assert.match(main, /<ol class="steps-track">/);
  assert.equal((main.match(/<li>/g) ?? []).length >= 3, true);
  assert.match(landingCss, /counter-increment: step/);
  // The old design stamped 01 / 02 / 03 markers on non-sequential sections.
  assert.doesNotMatch(main, /\b0[1-4]\s*\/\s*[A-Z]/);
});

test("shop uses the same retail layout system as the landing page", () => {
  assert.match(shopHtml, /<link rel="stylesheet" href="shop\.css" \/>/);

  // The compact catalog heading is visible; both routes share shopping surfaces.
  assert.doesNotMatch(shopHtml, /shop-head|shop-page-hero|shop-page-glow|shop-page-tags/);
  assert.doesNotMatch(shopCss, /\.shop-head|\.shop-count/);
  assert.match(shopHtml, /<h1 id="catalog-title">/);
  for (const page of [html, shopHtml]) assert.match(page, /src="storefront-ui\.js"/);

  // Product detail is rendered into its own page: image column beside a sticky
  // buy panel. The popup it used to open in is gone from every surface.
  assert.match(script, /<article class="pdp">/);
  assert.match(script, /class="pdp-media"/);
  assert.match(script, /class="pdp-panel"/);
  assert.match(shopCss, /\.pdp-panel \{[^}]*position: sticky;/);
  assert.doesNotMatch(script + storefrontUi + shopHtml + productHtml + shopCss, /product-modal|data-open-product/);

  // Photography stays contained, with a stable square image area on both pages.
  assert.match(shopCss, /\.catalog-card-image \{[^}]*aspect-ratio: 1;/);
  assert.match(shopCss, /\.catalog-card-image img \{[^}]*object-fit: contain;/);
  assert.match(shopCss, /\.catalog-card \{[^}]*border-radius: 12px;/);

  // No decorative arrows survive in the shop's own buttons or generated markup.
  for (const button of shopHtml.matchAll(/<(?:a|button) class="(?:button|shop-add-button|checkout-button)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)) {
    assert.doesNotMatch(button[1], /[→↗↓↖+]/, `decorative glyph in shop button: ${button[1].trim()}`);
  }
  assert.doesNotMatch(script, /catalog-card-view[^<]*<b>/);

  // The old landing/shop rules are gone from the shared stylesheet.
  assert.doesNotMatch(css, /\.catalog-card|\.pdp-panel|\.cart-drawer|\.shop-product/);
});

test("every product has its own page, reachable as an ordinary link", () => {
  const files = JSON.parse(read("build.mjs").match(/const files = (\[[\s\S]*?\]);/)[1].replace(/,\s*]/, "]"));
  const publicPaths = JSON.parse(read("preview-static.mjs").match(/const publicPaths = new Set\((\[[\s\S]*?\])\)/)[1].replace(/,\s*]/, "]"));
  const config = JSON.parse(read("vercel.json"));
  const address = "/products/product-1234abcd-5678-90ef-1234-567890abcdef";

  // A function answers the route on both hosts, so the sharing metadata is
  // filled in before a crawler that never runs the script sees the page.
  assert.ok(config.rewrites.some(rule => /^\/products\//.test(rule.source) && rule.destination === "/api/product-page?id=$1"));
  assert.equal(config.functions["api/product-page.mjs"].includeFiles, "product.html", "the document travels with the function");
  assert.match(read("server.mjs"), /PRODUCT_PATH\.test\(pathname\) \? productPageHandler/);
  assert.ok(files.includes("product.html"), "build list");
  assert.ok(publicPaths.includes("/product.html"), "preview list");
  assert.equal(read("dist/product.html"), productHtml, "built product.html");

  // Only the id shape reaches the page; nothing else matches the route.
  assert.equal(PRODUCT_PATH.test(address), true);
  for (const path of ["/products/", "/products/a", "/products/one/two", "/products/../../.env.local", "/products/.env", "/products/a b"])
    assert.equal(PRODUCT_PATH.test(path), false, path);

  // The card links out with real anchors, so a new tab and a share both work.
  assert.match(script, /const productHref = \(id\) => `\/products\/\$\{encodeURIComponent\(id\)\}`/);
  assert.equal((script.match(/href="\$\{escapeHtml\(productHref\(product\.id\)\)\}"/g) || []).length, 3);
  assert.match(script, /<h3 class="catalog-card-name"><a href=/);

  // The page renders from the address alone, with a state for each outcome.
  assert.match(script, /window\.location\.pathname\.match\(\/\^\\\/products/);
  assert.match(script, /fetch\(`\/api\/products\?id=\$\{encodeURIComponent\(productPageId\)\}`/);
  for (const state of ["loading", "missing", "error"]) assert.ok(script.includes(`${state}:`), state);
  assert.match(productHtml, /id="product-detail"/);
  assert.match(shopCss, /\.product-detail-loading \{/);
  assert.match(shopCss, /\.product-missing \{/);

  // Assets and scripts are addressed from the root: this page sits a level
  // deeper than the other documents. The empty canonical href is the
  // self-referential placeholder the script fills in with the product's address.
  assert.doesNotMatch(productHtml, /(?:href|src)="(?!\/|#|https:|")/);
  assert.match(productHtml, /<link rel="canonical" href="" \/>/);
  assert.match(script, /link\[rel="canonical"\]/);
  assert.match(read("storefront-ui.js"), /href="\/assets\/icons\.svg#/);
});

test("shop is a standalone page linked from the landing page", () => {
  assert.match(html, /href="\/shop"/);
  assert.doesNotMatch(html, /id="shop"/);
  assert.doesNotMatch(html, /id="cart-drawer"/);
  assert.match(shopHtml, /<body class="shop-page">/);
  assert.match(shopHtml, /id="catalog-title"/);
  assert.match(shopHtml, /id="shop"/);
});

test("all conversion links use verified destinations and analytics attributes", () => {
  const externalAnchors = [...html.matchAll(/<a\b[\s\S]*?<\/a>/g)]
    .map((match) => match[0])
    .filter((anchor) => anchor.includes(instagram) || anchor.includes(maps));

  assert.deepEqual(new Set(externalAnchors.map(anchor => anchor.match(/href="([^"]+)"/)?.[1])), new Set([instagram, maps]));

  for (const anchor of externalAnchors) {
    const href = anchor.match(/href="([^"]+)"/)?.[1];
    const location = anchor.match(/data-analytics-location="([^"]+)"/)?.[1];
    const destination = anchor.match(/data-analytics-destination="([^"]+)"/)?.[1];

    assert.ok([instagram, maps].includes(href), `unverified external destination: ${href}`);
    assert.ok(["hero", "product", "category", "mobile", "store", "footer"].includes(location), `invalid analytics location: ${location}`);
    assert.equal(destination, href === instagram ? "instagram" : "maps");
  }

  assert.match(script, /name: "outbound_click"/);
  assert.match(script, /typeof window\.va !== "function"/);
  assert.match(html, /src="\/_vercel\/insights\/script\.js"/);
});

test("SEO metadata and structured data only use verified store details", () => {
  assert.match(html, /<title>NeoSport Namangan — Erkaklar sport kiyimlari<\/title>/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:image" content="\/assets\/neosport-hero\.png"/);
  assert.doesNotMatch(html, /rel="canonical"/i);

  const jsonText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonText, "missing JSON-LD");
  const store = JSON.parse(jsonText);

  assert.equal(store["@type"], "Store");
  assert.equal(store.name, "NeoSport");
  assert.equal(store.address.addressLocality, "Namangan");
  assert.equal(store.geo.latitude, 41.0139);
  assert.equal(store.geo.longitude, 71.6372);
  assert.deepEqual(store.sameAs, [instagram]);
  assert.equal(store.hasMap, maps);

  for (const unsupportedField of ["telephone", "openingHours", "streetAddress", "priceRange"]) {
    assert.equal(JSON.stringify(store).includes(unsupportedField), false, `unsupported ${unsupportedField} in structured data`);
  }
});

test("displayed images have WebP sources, PNG fallbacks, and intrinsic dimensions", () => {
  for (const basename of ["neosport-hero", "neosport-mark"]) {
    assert.ok(existsSync(join(root, "assets", `${basename}.png`)));
    assert.ok(existsSync(join(root, "assets", `${basename}.webp`)));
  }

  assert.match(landingCss, /neosport-hero\.webp/);
  assert.match(landingCss, /neosport-hero\.png/);
  assert.match(html, /rel="preload" as="image" href="assets\/neosport-hero\.webp"/);

  // Product photography no longer lives in the repo; the admin panel supplies it.
  assert.equal(existsSync(join(root, "assets", "products")), false);
  assert.equal(existsSync(join(root, "product-source")), false);

  const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(images.length > 0);
  for (const image of images) {
    assert.match(image, /\bwidth="\d+"/);
    assert.match(image, /\bheight="\d+"/);
  }

  // The hero is the one heavy photo, and WebP has to earn its place against the PNG.
  const heroPng = statSync(join(root, "assets", "neosport-hero.png")).size;
  const heroWebp = statSync(join(root, "assets", "neosport-hero.webp")).size;
  assert.ok(heroWebp <= heroPng * 0.4, "WebP transfer reduction is below 60%");
});

test("menu and motion code include accessibility fallbacks", () => {
  assert.match(script, /event\.key !== "Escape"/);
  assert.match(script, /setMenuState\(false, true\)/);
  assert.match(script, /"IntersectionObserver" in window/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(css, /html:not\(\.js\) \.site-nav/);
  assert.match(css, /:focus-visible/);

  for (const sheet of [landingCss, shopCss]) {
    assert.match(sheet, /@media \(prefers-reduced-motion: reduce\)/);
  }

  // Nothing animates in on scroll any more, so the reveal system is gone.
  assert.doesNotMatch(html + shopHtml, /class="[^"]*\breveal\b/);
  assert.doesNotMatch(css + landingCss + shopCss, /\.reveal/);
  assert.doesNotMatch(script, /revealElements/);
});

test("runtime image fallbacks point at assets the build ships", () => {
  const fallbacks = [...script.matchAll(/["'](assets\/[a-z0-9/-]+\.(?:webp|png|jpg))["']/g)].map((m) => m[1]);
  assert.ok(fallbacks.length > 0);

  for (const asset of new Set(fallbacks)) {
    assert.ok(existsSync(join(root, "dist", asset)), `script.js references ${asset}, which the build does not ship`);
  }
});

test("no product is hardcoded into the site, the client, or the service", () => {
  assert.doesNotMatch(html, /id="new-model"/);
  assert.doesNotMatch(html, /WOVEN UTILITY/i);
  assert.doesNotMatch(css + landingCss, /\.featured-product|\.product-thumb\b/);

  // The Skechers set was the last seeded product; it is gone from every layer.
  assert.doesNotMatch(html + shopHtml + script, /skechers-woven-utility/);
  assert.doesNotMatch(read("product-service.mjs"), /defaultProduct/);
  assert.match(script, /^const catalogue = \{\};$/m);

  assert.match(html, /href="\/shop"/);
});

test("online shop supports variants, a persistent cart, and customer checkout", () => {
  for (const id of ["shop", "catalog-grid", "catalog-empty", "cart-drawer", "cart-items", "checkout-form"]) {
    assert.match(shopHtml + storefrontUi, new RegExp(`id="${id}"`));
  }

  // Colour and size pickers are generated per product from the API payload.
  assert.match(script, /name="color"/);
  assert.match(script, /name="size"/);
  assert.match(storefrontUi, /name="name"[\s\S]*?autocomplete="name"/);
  assert.match(storefrontUi, /name="phone"[\s\S]*?autocomplete="tel"/);
  assert.match(script, /neosport-cart-v1/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /fetch\("\/api\/order"/);
  assert.match(script, /name: "add_to_cart"/);
  assert.match(script, /name: "order_submitted"/);
  assert.match(shopHtml, /<footer class="site-footer">/);
  assert.match(css, /\.site-footer\s*\{/);
  assert.doesNotMatch(css, /(^|\n)footer\s*\{/);
});

test("mobile navigation stays out of layout when closed and map marker has no logo", () => {
  assert.match(css, /\.js \.site-nav:not\(\.is-open\)\s*\{\s*display: none;/);
  assert.match(shopCss, /@media \(max-width: 767px\)[\s\S]*?\.cart-drawer/);
  const mapPin = html.match(/<div class="map-pin">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.doesNotMatch(mapPin, /<img|neosport-mark/);
  // The marker is drawn in CSS rather than reusing the brand logo.
  assert.match(landingCss, /\.place-map \.map-pin \{[\s\S]*?background: var\(--lime\)/);
});

test("admin panel and server-side product management are wired", () => {
  const adminHtml = read("admin-product.html");
  const adminScript = read("admin-product.js");

  assert.match(adminHtml, /id="login-form"/);
  assert.match(adminHtml, /id="product-admin-form"/);
  assert.match(adminHtml, /name="image-file"/);
  // Size checkboxes are rendered from the category, so they live in the script.
  assert.match(adminHtml, /id="size-checks"/);
  assert.match(adminScript, /name="sizes"/);
  assert.match(adminHtml, /name="color-label"/);
  assert.match(adminScript, /\/api\/admin\/products/);
  assert.match(script, /fetch\("\/api\/products"/);

  resetRateLimits();
  assert.throws(
    () => requireAdmin(fakeRequest({ authorization: "Bearer wrong" }), { ADMIN_PASSWORD: "correct-password" }),
    /Parol noto‘g‘ri/,
  );
  assert.doesNotThrow(() =>
    requireAdmin(fakeRequest({ authorization: "Bearer correct-password" }), { ADMIN_PASSWORD: "correct-password" }),
  );
});

test("the catalog starts empty and is filled from the admin panel", () => {
  assert.deepEqual(JSON.parse(read("data/products.json")), []);

  // The shop renders whatever /api/products returns, and says so when that is nothing.
  assert.match(shopHtml, /id="catalog-empty"/);
  assert.match(shopCss, /\.catalog-empty \{/);
  assert.match(script, /const renderCatalog = /);
  assert.match(script, /if \(catalogEmpty\) catalogEmpty\.hidden = products\.length > 0;/);

  // The admin list has an empty state of its own.
  assert.match(read("admin-products.js"), /admin-empty/);
});

test("Telegram order service recalculates trusted totals and formats customer details", async () => {
  // The local catalog is empty by design, so the order runs against a stubbed database.
  const environment = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_CHAT_ID: "test-chat",
  };
  const rows = [
    {
      id: "test-track-set",
      name: "Test Track komplekti",
      brand: "Skechers",
      category: "Komplekt",
      price: 589000,
      description: "Test uchun komplekt.",
      sizes: ["L", "XL"],
      colors: [{ id: "teal", label: "To‘q yashil", hex: "#163c3e" }],
      image_url: "https://example.supabase.co/track-set.webp",
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "test-legend-tee",
      name: "Test Legend futbolkasi",
      brand: "Nike",
      category: "Futbolka",
      price: 349000,
      description: "Test uchun futbolka.",
      sizes: ["L"],
      colors: [{ id: "black", label: "Qora", hex: "#111111" }],
      image_url: "https://example.supabase.co/legend-tee.webp",
      active: true,
      created_at: "2026-01-02T00:00:00.000Z",
    },
  ];

  const originalFetch = globalThis.fetch;
  let telegramRequest;
  let storedOrder;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/rest/v1/products")) {
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/rest/v1/orders")) {
      storedOrder = JSON.parse(options.body);
      return new Response(null, { status: 204 });
    }
    telegramRequest = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await createTelegramOrder(
      {
        name: "Azizbek Karimov",
        phone: "+998 90 123 45 67",
        items: [
          { productId: "test-track-set", color: "teal", size: "XL", quantity: 2 },
          { productId: "test-legend-tee", color: "black", size: "L", quantity: 1 },
        ],
      },
      environment,
    );

    assert.match(result.orderId, /^NS-/);
    assert.match(telegramRequest.url, /api\.telegram\.org\/bottest-token\/sendMessage/);
    assert.equal(telegramRequest.body.chat_id, "test-chat");
    assert.match(telegramRequest.body.text, /Azizbek Karimov/);
    assert.match(telegramRequest.body.text, /To‘q yashil/);
    assert.match(telegramRequest.body.text, /Test Legend futbolkasi/);
    assert.match(telegramRequest.body.text, /1[\s\u00a0]?527[\s\u00a0]?000 so‘m/);

    // The order is kept so the statistics have something to count.
    assert.equal(storedOrder.id, result.orderId);
    assert.equal(storedOrder.total, 1527000);
    assert.equal(storedOrder.customer_phone, "+998 90 123 45 67");
    assert.equal(storedOrder.items.length, 2);
    assert.equal(storedOrder.items[0].quantity, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty catalog rejects orders instead of trusting the client", async () => {
  await assert.rejects(
    () =>
      createTelegramOrder(
        {
          name: "Azizbek Karimov",
          phone: "+998 90 123 45 67",
          items: [{ productId: "test-track-set", color: "teal", size: "XL", quantity: 1 }],
        },
        { TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "test-chat" },
      ),
    /noto‘g‘ri mahsulot/,
  );
});

const adminPages = [
  ["/admin", "admin.html", "admin-stats.js"],
  ["/admin/categories", "admin-categories.html", "admin-categories.js"],
  ["/admin/products", "admin-products.html", "admin-products.js"],
  ["/admin/product", "admin-product.html", "admin-product.js"],
  ["/admin/customers", "admin-customers.html", "admin-customers.js"],
];

test("every admin document and module is explicitly published and served", () => {
  const files = JSON.parse(read("build.mjs").match(/const files = (\[[\s\S]*?\]);/)[1].replace(/,\s*]/, "]"));
  const publicPaths = JSON.parse(read("preview-static.mjs").match(/const publicPaths = new Set\((\[[\s\S]*?\])\)/)[1].replace(/,\s*]/, "]"));
  const config = JSON.parse(read("vercel.json"));
  assert.equal(config.cleanUrls, false);
  assert.equal(config.trailingSlash, false);
  assert.deepEqual(readdirSync(root).filter(file => /^admin(?:-.*)?\.html$/.test(file)).sort(), adminPages.map(([, file]) => file).sort());
  for (const [route, document, script] of adminPages) {
    assert.ok(config.rewrites.some(rule => rule.source === route && rule.destination === `/${document}`), route);
    assert.ok(read("server.mjs").includes(`"${route}": "${document}"`), `local route ${route}`);
    assert.ok(publicPaths.includes(route), route);
    assert.ok(isPublicPreviewPath(route), route);
    for (const file of [document, script, "admin-shell.js"]) {
      assert.ok(files.includes(file), `build list ${file}`);
      assert.ok(publicPaths.includes(`/${file}`), `preview list ${file}`);
      assert.ok(isPublicPreviewPath(`/${file}`), file);
      assert.equal(read(`dist/${file}`), read(file), `built ${file}`);
    }
  }
  assert.equal(isPublicPreviewPath("/admin-auth.mjs"), false);
  assert.equal(isPublicPreviewPath("/admin.js"), false);
});

test("admin documents wait for authentication and load only their task module", () => {
  for (const [, document, script] of adminPages) {
    const page = read(document);
    assert.match(page, /id="login-layer" hidden/);
    assert.match(page, /id="admin-shell" hidden/);
    assert.equal((page.match(/data-admin-view=/g) || []).length, 1);
    assert.ok(page.includes(`<script type="module" src="/${script}">`));
    assert.match(read(script), /from "\.\/admin-shell\.js"/);
    assert.doesNotMatch(page, /data-view=|src="admin\.js"|(?:src|href)="assets\//);
  }
  const shell = read("admin-shell.js");
  assert.match(shell, /location\.replace\(legacyPage/);
  assert.match(shell, /beforeunload/);
  assert.doesNotMatch(shell, /setAdminView|document\.addEventListener\("click"|\/api\/admin\//);
  for (const script of ["admin-product.js", "admin-products.js", "admin-categories.js", "admin-customers.js"]) {
    assert.doesNotMatch(read(script), /loadStats|\/api\/admin\/stats|showLogin/);
  }
});

test("production output is complete and excludes unused media", () => {
  for (const file of [
    "index.html",
    "shop.html",
    "styles.css",
    "landing.css",
    "shop.css",
    "script.js",
    "storefront-ui.js",
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
  ]) {
    assert.ok(existsSync(join(root, "dist", file)), `missing dist/${file}`);
  }

  const productionAssets = readdirSync(join(root, "dist", "assets"))
    .filter((name) => statSync(join(root, "dist", "assets", name)).isFile())
    .sort();
  assert.deepEqual(productionAssets, [
    "icons.svg",
    "lucide-LICENSE",
    "neosport-hero.png",
    "neosport-hero.webp",
    "neosport-mark.png",
    "neosport-mark.webp",
  ]);
});

/* ------------------------------------------- admin: editing and discounts -- */

const supabaseEnvironment = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
};

const productRow = (overrides = {}) => ({
  id: "test-track-set",
  name: "Test Track komplekti",
  brand: "Skechers",
  category: "Komplekt",
  price: 589000,
  discount_percent: 0,
  description: "Test uchun komplekt.",
  sizes: ["L", "XL"],
  colors: [{ id: "color-1", label: "Qora", hex: "#111111" }],
  image_url: "https://example.supabase.co/track-set.webp",
  active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  ...overrides,
});

const withStubbedFetch = async (handler, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("a discounted price is rounded to whole thousands and never falls below the floor", () => {
  assert.equal(effectivePrice(589000, 0), 589000, "no discount leaves the price untouched");
  assert.equal(effectivePrice(349000, 20), 279000);
  assert.equal(effectivePrice(650000, 35), 423000, "422 500 rounds to a price a shop would print");
  assert.equal(effectivePrice(1000, MAX_DISCOUNT_PERCENT), 1000, "the 1000 so‘m floor holds");

  // The storefront and the admin panel repeat this formula; they must agree.
  assert.match(read("script.js"), /finalPrice/);
  assert.match(read("admin-shell.js"), /const effectivePrice = /);
});

test("an edit without a new photo keeps the stored image and rejects a bad discount", async () => {
  let patchBody;
  await withStubbedFetch(
    async (url, options) => {
      patchBody = JSON.parse(options.body);
      return new Response(JSON.stringify([productRow({ price: 650000, discount_percent: 35, updated_at: "2026-09-07T00:00:00.000Z" })]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async () => {
      const product = await updateProduct(
        "test-track-set",
        {
          name: "Test Track komplekti PRO",
          brand: "Skechers",
          category: "Komplekt",
          price: 650000,
          discountPercent: 35,
          description: "Tahrirlangan tavsif.",
          sizes: ["L", "XL", "2XL"],
          colors: [{ label: "Qora", hex: "#111111" }],
          image: "",
        },
        supabaseEnvironment,
      );

      assert.equal(product.finalPrice, 423000);
      assert.equal(product.discountPercent, 35);
    },
  );

  // No image was supplied, so image_url must not be part of the patch.
  assert.equal("image_url" in patchBody, false);
  assert.equal(patchBody.discount_percent, 35);
  assert.equal(patchBody.price, 650000);

  await assert.rejects(
    () => updateProduct("test-track-set", { name: "X", price: 100 }, supabaseEnvironment),
    /Narxni so‘mda/,
  );
  await assert.rejects(
    () =>
      updateProduct(
        "test-track-set",
        {
          name: "Test Track komplekti",
          brand: "Skechers",
          category: "Komplekt",
          price: 650000,
          discountPercent: 95,
          description: "Tahrirlangan tavsif.",
          sizes: ["L"],
          colors: [{ label: "Qora", hex: "#111111" }],
        },
        supabaseEnvironment,
      ),
    /Chegirma 0 dan 90 foizgacha/,
  );
});

test("statistics aggregate the catalog and the stored orders", async () => {
  const orders = [
    {
      id: "NS-1",
      created_at: new Date().toISOString(),
      customer_name: "Azizbek Karimov",
      customer_phone: "+998 90 123 45 67",
      items: [{ productId: "test-legend-tee", name: "Test Legend futbolkasi", brand: "Nike", quantity: 2, unitPrice: 279000, subtotal: 558000 }],
      total: 558000,
    },
    {
      id: "NS-2",
      created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      customer_name: "Bekzod Aliyev",
      customer_phone: "+998 91 000 00 00",
      items: [{ productId: "test-track-set", name: "Test Track komplekti", brand: "Skechers", quantity: 1, unitPrice: 589000, subtotal: 589000 }],
      total: 589000,
    },
  ];

  const stats = await withStubbedFetch(
    async (url) => {
      const body = String(url).includes("/rest/v1/orders")
        ? orders
        : [productRow(), productRow({ id: "test-legend-tee", brand: "Nike", category: "Futbolka", price: 349000, discount_percent: 20, active: false })];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    () => buildStats(supabaseEnvironment),
  );

  assert.equal(stats.catalog.total, 2);
  assert.equal(stats.catalog.active, 1);
  assert.equal(stats.catalog.inactive, 1);
  // The inactive product is discounted, so it is not part of the sellable value.
  assert.equal(stats.catalog.catalogValue, 589000);
  assert.deepEqual(stats.catalog.brands.map((brand) => brand.name).sort(), ["Nike", "Skechers"]);

  assert.equal(stats.orders.today.count, 1);
  assert.equal(stats.orders.today.revenue, 558000);
  assert.equal(stats.orders.last7Days.count, 1);
  assert.equal(stats.orders.last30Days.count, 2);
  assert.equal(stats.orders.allTime.revenue, 1147000);
  assert.equal(stats.orders.allTime.items, 3);
  assert.equal(stats.orders.topProducts[0].name, "Test Legend futbolkasi");
  assert.equal(stats.orders.recent[0].id, "NS-1");
});

test("statistics survive a missing order history", async () => {
  const stats = await withStubbedFetch(
    async (url) => {
      if (String(url).includes("/rest/v1/orders")) return new Response("relation does not exist", { status: 404 });
      return new Response(JSON.stringify([productRow()]), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    () => buildStats(supabaseEnvironment),
  );

  assert.equal(stats.orders, null, "a store without an orders table still reports on its catalog");
  assert.equal(stats.catalog.total, 1);
});

test("the admin panel exposes adding, editing, discounts, and statistics", () => {
  const adminHtml = read("admin-product.html");
  const adminScript = read("admin-product.js");
  const adminCss = read("admin.css");

  // Add and edit share one form; the heading and button switch mode.
  assert.match(adminHtml, /id="product-form-title"/);
  assert.match(adminHtml, /id="cancel-edit-button"/);
  assert.match(adminScript, /const startEdit = /);
  assert.match(adminScript, /const exitEditMode = /);
  assert.match(adminScript, /method: "PATCH"/);

  // Discounts: an input, a live preview of the resulting price, a list badge.
  assert.match(adminHtml, /name="discountPercent"/);
  assert.match(adminHtml, /id="price-preview"/);
  assert.match(adminScript, /const updatePricePreview = /);
  assert.match(adminCss, /\.price-preview \{/);

  // Visibility toggle instead of deleting seasonal stock.
  assert.match(read("admin-products.js"), /data-toggle-product/);
  assert.match(read("admin-products.js"), /JSON\.stringify\(\{ active: !product\.active \}\)/);

  // Statistics block with its own endpoint.
  assert.match(read("admin.html"), /id="stats-body"/);
  assert.match(read("admin.html"), /id="stats-refresh"/);
  assert.match(read("admin-stats.js"), /\/api\/admin\/stats/);
  assert.match(adminCss, /\.stat-tile \{/);
  assert.match(read("api/admin/stats.mjs"), /requireAdmin/);

  // Customer list: its own admin-only endpoint, opened from the menu.
  assert.match(read("admin-shell.js"), /data-view="customers"/);
  assert.match(read("admin-customers.html"), /id="admin-customer-list"/);
  assert.match(read("admin-customers.html"), /id="customer-search"/);
  assert.match(read("admin-customers.js"), /\/api\/admin\/customers/);
  assert.match(adminCss, /\.admin-customer \{/);
  assert.match(read("api/admin/customers.mjs"), /requireAdmin/);
  // Nothing is written from this section, so the panel never asks for one.
  assert.doesNotMatch(read("admin-customers.js"), /customers.*method: "(POST|PATCH|DELETE)"/);
});

test("the customer list joins every order to the person who placed it", async () => {
  // Newest first, the way `order=created_at.desc` answers.
  const users = [
    { id: "tg:7", phone: "998911112233", full_name: "Bekzod Aliyev", telegram_chat_id: "7", created_at: "2026-06-01T10:00:00Z", last_login_at: "2026-06-02T10:00:00Z" },
    { id: "tg:6", phone: "998901234567", full_name: "Azizbek ikkinchi akkaunt", telegram_chat_id: "6", created_at: "2026-05-01T10:00:00Z", last_login_at: "2026-05-02T10:00:00Z" },
    { id: "tg:5", phone: "+998 90 123 45 67", full_name: "Azizbek Karimov", telegram_chat_id: "5", created_at: "2026-03-01T10:00:00Z", last_login_at: "2026-09-01T10:00:00Z" },
  ];
  const orders = [
    { id: "NS-1", created_at: "2026-09-05T09:00:00Z", customer_phone: "+998 90 123 45 67", user_id: "tg:5", items: [], total: 500000 },
    // Placed before that customer ever signed in: only the number identifies them.
    { id: "NS-2", created_at: "2026-02-01T09:00:00Z", customer_phone: "998901234567", user_id: null, items: [], total: 300000 },
    { id: "NS-3", created_at: "2026-06-10T09:00:00Z", customer_phone: "998911112233", user_id: "tg:7", items: [], total: 200000 },
    { id: "NS-4", created_at: "2026-07-10T09:00:00Z", customer_phone: "998933334455", user_id: null, items: [], total: 100000 },
  ];

  const { customers, source, ordersAvailable } = await withStubbedFetch(
    async (url) =>
      new Response(JSON.stringify(String(url).includes("/rest/v1/orders") ? orders : users), { status: 200 }),
    () => listCustomers(supabaseEnvironment),
  );

  assert.equal(source, "users");
  assert.equal(ordersAvailable, true);
  assert.deepEqual(customers.map((customer) => customer.id), ["tg:5", "tg:7", "tg:6"], "most recent activity first");

  const [azizbek, bekzod, second] = customers;
  assert.equal(azizbek.phone, "998901234567", "every spelling of the number is stored the same way");
  assert.equal(azizbek.orders.count, 2, "the order placed before signing in still belongs to him");
  assert.equal(azizbek.orders.total, 800000);
  assert.equal(azizbek.orders.lastAt, "2026-09-05T09:00:00Z");
  assert.equal(bekzod.orders.count, 1);
  // One number, two Telegram accounts: the older account keeps the history, so
  // the same 300 000 so'm is never counted against both.
  assert.equal(second.orders.count, 0);
  assert.equal(
    customers.reduce((sum, customer) => sum + customer.orders.total, 0),
    1000000,
    "the order from a number with no account is left out rather than double counted",
  );
});

test("customers survive a store with no database and an unreachable order table", async () => {
  const users = [{ id: "tg:5", phone: "998901234567", full_name: "Azizbek Karimov", created_at: "2026-03-01T10:00:00Z", last_login_at: "2026-09-01T10:00:00Z" }];

  // The users table answers; the orders table does not.
  const partial = await withStubbedFetch(
    async (url) =>
      String(url).includes("/rest/v1/orders")
        ? new Response("no such table", { status: 404 })
        : new Response(JSON.stringify(users), { status: 200 }),
    () => listCustomers(supabaseEnvironment),
  );
  assert.equal(partial.ordersAvailable, false, "the panel is told the purchase totals are missing");
  assert.equal(partial.customers.length, 1, "the customer is still listed");
  assert.equal(partial.customers[0].orders.total, 0);

  // No database at all: the orders on disk are the only record of who bought.
  const { customers, source } = await listCustomers({});
  assert.equal(source, "orders");
  assert.ok(Array.isArray(customers));
});

test("the storefront prints the discounted price and charges it", () => {
  // Sale price first, the price it replaces struck through, then the badge.
  assert.match(script, /is-discounted/);
  assert.match(script, /<s>\$\{formatPlain\(product\.price\)\}<\/s>/);
  assert.match(shopCss, /\.catalog-card-price s \{/);
  assert.match(shopCss, /\.pdp-price b \{/);

  // The cart total follows the discounted price, not the list price.
  assert.match(script, /price: product\.finalPrice/);
  assert.match(read("order-service.mjs"), /const unitPrice = product\.finalPrice \?\? product\.price;/);
});

test("the orders table is defined and kept out of the repository", () => {
  const schema = read("supabase-schema.sql");
  assert.match(schema, /create table if not exists public\.orders/);
  assert.match(schema, /alter table public\.orders enable row level security/);
  assert.match(schema, /discount_percent smallint not null default 0/);

  // Local order history holds customer names and phone numbers.
  assert.match(read(".gitignore"), /data\/orders\.json/);
});

test("image rules set both dimensions so the HTML size attributes cannot stretch them", () => {
  // Every <img> carries width/height attributes as presentational hints. A CSS
  // rule that overrides only width leaves the attribute height in force, which
  // is what stretched the admin login logo to 54x540.
  for (const [name, sheet] of [
    ["admin.css", read("admin.css")],
    ["styles.css", css],
    ["landing.css", landingCss],
    ["shop.css", shopCss],
  ]) {
    // Comments are stripped first: one of them mentions "img" and would
    // otherwise be read as part of the following selector.
    for (const rule of sheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*\bimg\b[^{}]*)\{([^}]*)\}/g)) {
      const [, selector, body] = rule;
      if (!/(^|[;\s])width\s*:/.test(body)) continue;
      assert.match(body, /(^|[;\s])height\s*:/, `${name}: "${selector.trim()}" sets width without height`);
    }
  }

  assert.match(read("admin.css"), /\.login-card img \{[^}]*height: auto;/);
});

/* ------------------------------------------------- Google sign-in sessions -- */

const sessionEnvironment = {
  SESSION_SECRET: "a-test-secret-that-is-long-enough-to-pass",
  ADMIN_EMAILS: "paxbyme@gmail.com",
};

const googleUser = { id: "google-sub-123", email: "paxbyme@gmail.com", name: "Pax", picture: "https://example.com/a.png" };

test("a session cookie round-trips and carries no role of its own", () => {
  const cookie = createSessionCookie(googleUser, { environment: sessionEnvironment });

  assert.match(cookie, /^ns_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  // Secure would stop the cookie working over plain http in development.
  assert.doesNotMatch(cookie, /Secure/);

  const session = readSession(fakeRequest({ cookie: asCookieHeader(cookie) }), sessionEnvironment);
  assert.equal(session.id, "google-sub-123");
  assert.equal(session.email, "paxbyme@gmail.com");
  assert.equal(session.role, "admin");

  // The very same cookie is only a customer once the address is not listed.
  const demoted = readSession(fakeRequest({ cookie: asCookieHeader(cookie) }), {
    ...sessionEnvironment,
    ADMIN_EMAILS: "someone-else@gmail.com",
  });
  assert.equal(demoted.role, "customer", "admin rights must be revocable without waiting for the session to expire");
});

test("a tampered or unsigned session is rejected", () => {
  const cookie = asCookieHeader(createSessionCookie(googleUser, { environment: sessionEnvironment }));
  const [, token] = cookie.split("=");
  const [payload, signature] = decodeURIComponent(token).split(".");

  // Same payload, signed with a different secret.
  const forged = createSessionCookie(googleUser, {
    environment: { ...sessionEnvironment, SESSION_SECRET: "a-different-secret-that-is-also-long-enough" },
  });
  assert.equal(readSession(fakeRequest({ cookie: asCookieHeader(forged) }), sessionEnvironment), null);

  // Payload edited, old signature kept.
  const edited = Buffer.from(JSON.stringify({ sub: "x", email: "attacker@example.com", exp: 9999999999 })).toString("base64url");
  assert.equal(readSession(fakeRequest({ cookie: `${SESSION_COOKIE}=${edited}.${signature}` }), sessionEnvironment), null);

  assert.equal(readSession(fakeRequest({ cookie: `${SESSION_COOKIE}=${payload}` }), sessionEnvironment), null);
  assert.equal(readSession(fakeRequest({}), sessionEnvironment), null);

  // A secret too short to be safe must not produce a usable session.
  assert.throws(() => createSessionCookie(googleUser, { environment: { SESSION_SECRET: "short" } }), /Sessiya kaliti/);
});

test("an expired session is not accepted", () => {
  const expired = createSessionCookie(googleUser, { environment: sessionEnvironment });
  const token = decodeURIComponent(asCookieHeader(expired).split("=")[1]);
  const [payload] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

  assert.ok(claims.exp > claims.iat, "the session has to carry an expiry");
  assert.ok(claims.exp - claims.iat <= 30 * 24 * 60 * 60, "sessions must not outlive 30 days");
});

test("admin access follows ADMIN_EMAILS, not the cookie or a password", () => {
  resetRateLimits();
  const adminCookie = asCookieHeader(createSessionCookie(googleUser, { environment: sessionEnvironment }));

  const session = requireAdmin(fakeRequest({ cookie: adminCookie }), sessionEnvironment);
  assert.equal(session.role, "admin");

  // A signed-in customer gets 403, and is never offered the password path.
  const customerCookie = asCookieHeader(
    createSessionCookie({ ...googleUser, email: "mijoz@gmail.com" }, { environment: sessionEnvironment }),
  );
  assert.throws(
    () => requireAdmin(fakeRequest({ cookie: customerCookie }), { ...sessionEnvironment, ADMIN_PASSWORD: "correct" }),
    (error) => error.status === 403 && /admin huquqi yo‘q/.test(error.message),
  );

  // With no session and no password configured, there is simply no way in.
  assert.throws(
    () => requireAdmin(fakeRequest({}), { SESSION_SECRET: sessionEnvironment.SESSION_SECRET }),
    /Google orqali kiring/,
  );

  assert.equal(isAdminEmail("PaxByMe@Gmail.com", sessionEnvironment), true, "the allowlist is case-insensitive");
  assert.equal(isAdminEmail("", sessionEnvironment), false);
});

test("password attempts are rate limited", () => {
  resetRateLimits();
  const environment = { ADMIN_PASSWORD: "correct-password" };
  const attempt = () => requireAdmin(fakeRequest({ authorization: "Bearer wrong" }), environment);

  for (let index = 0; index < 10; index += 1) {
    assert.throws(attempt, /Parol noto‘g‘ri/, `attempt ${index + 1} should still be checked`);
  }

  // The eleventh attempt inside the window is refused before the comparison.
  assert.throws(attempt, (error) => error.status === 429 && /Juda ko‘p urinish/.test(error.message));
  resetRateLimits();
});

test("the post-login redirect cannot leave the site", () => {
  assert.equal(safeNextPath("/shop"), "/shop");
  assert.equal(safeNextPath("/admin?tab=1"), "/admin?tab=1");

  for (const hostile of ["//evil.example.com", "https://evil.example.com", "javascript:alert(1)", "", null, "shop"]) {
    assert.equal(safeNextPath(hostile), "/", `${hostile} must not be used as a redirect target`);
  }
});

test("the Google callback URL is absolute and honours the deployment host", () => {
  assert.equal(
    callbackUrl(fakeRequest({ host: "localhost:4173" }), {}),
    "http://localhost:4173/api/auth/callback",
  );
  assert.equal(
    callbackUrl(fakeRequest({ host: "neosport-nu.vercel.app" }), { VERCEL: "1" }),
    "https://neosport-nu.vercel.app/api/auth/callback",
  );
  assert.equal(
    callbackUrl(fakeRequest({ host: "ignored" }), { SITE_URL: "https://neosport.uz/" }),
    "https://neosport.uz/api/auth/callback",
  );

  // Without Supabase credentials the sign-in button must not be offered.
  assert.equal(isAuthConfigured({}), false);
  assert.equal(
    isAuthConfigured({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" }),
    true,
  );
});

test("sign-in is offered on every page and orders stay optional", () => {
  for (const page of [html, shopHtml]) {
    assert.match(page, /<div class="account" id="account"/);
  }
  assert.match(read("admin.html"), /id="google-signin"/);
  assert.match(read("admin.html"), /\/api\/auth\/login\?next=\/admin/);

  // Guest checkout survives: the order endpoint reads a session but never demands one.
  const orderApi = read("api/order.mjs");
  assert.match(orderApi, /readSession\(request\)/);
  assert.doesNotMatch(orderApi, /401/);

  // A customer only ever sees their own orders.
  assert.match(read("api/orders.mjs"), /userId: session\.id/);
  assert.match(script, /\/api\/auth\/me/);
  assert.match(shopHtml, /id="account-orders"/);
});

test("the authorize URL leaves the OAuth state to Supabase", () => {
  // Passing our own `state` made Supabase reject the callback with
  // bad_oauth_state: it generates and validates its own for the PKCE flow.
  const url = new URL(
    googleAuthorizeUrl({
      verifier: "test-verifier",
      request: fakeRequest({ host: "localhost:4173" }),
      environment: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" },
    }),
  );

  assert.equal(url.searchParams.get("state"), null, "Supabase owns the OAuth state");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.ok(url.searchParams.get("code_challenge"), "PKCE challenge must still be sent");
  assert.equal(url.searchParams.get("redirect_to"), "http://localhost:4173/api/auth/callback");

  // The callback must not compare a state it never sent.
  assert.doesNotMatch(read("auth-routes.mjs"), /searchParams\.get\("state"\)/);
});

test("an uploaded photo is re-encoded to WebP and capped in width", async () => {
  const sharp = (await import("sharp")).default;
  // A deliberately oversized PNG, the way a phone camera would arrive.
  const original = await sharp({
    create: { width: 3000, height: 3750, channels: 3, background: { r: 168, g: 249, b: 0 } },
  })
    .png()
    .toBuffer();

  let upload;
  await withStubbedFetch(
    async (url, options) => {
      if (String(url).includes("/storage/v1/object/")) {
        upload = { url: String(url), contentType: options.headers["Content-Type"], body: options.body };
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([productRow()]), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    () =>
      createProduct(
        {
          name: "Rasm sinovi",
          brand: "NeoSport",
          category: "Komplekt",
          price: 300000,
          description: "Rasm optimizatsiyasini sinash.",
          sizes: ["L"],
          colors: [{ label: "Qora", hex: "#111111" }],
          image: `data:image/png;base64,${original.toString("base64")}`,
        },
        supabaseEnvironment,
      ),
  );

  assert.match(upload.url, /\.webp$/, "the stored file is WebP whatever was uploaded");
  assert.equal(upload.contentType, "image/webp");

  const stored = await sharp(upload.body).metadata();
  assert.equal(stored.format, "webp");
  assert.equal(stored.width, 1280, "wide images are capped");
  assert.ok(
    upload.body.length < original.length,
    `re-encoding must shrink the file (${upload.body.length} vs ${original.length})`,
  );
});

test("sharp ships as a runtime dependency, not a build-only one", () => {
  // The product API re-encodes uploads at request time, so sharp has to be
  // installed in the deployed function, not just during the build.
  const manifest = JSON.parse(read("package.json"));
  assert.ok(manifest.dependencies?.sharp, "sharp belongs in dependencies");
  assert.equal(manifest.devDependencies?.sharp, undefined);
});

test("a product carries up to ten photos, the first being the main one", async () => {
  const sharp = (await import("sharp")).default;
  const photo = async (shade) =>
    `data:image/png;base64,${(
      await sharp({ create: { width: 400, height: 500, channels: 3, background: { r: shade, g: 200, b: 40 } } })
        .png()
        .toBuffer()
    ).toString("base64")}`;
  const ten = await Promise.all([...Array(MAX_IMAGES)].map((_, index) => photo(index * 20)));

  const uploads = [];
  const product = await withStubbedFetch(
    async (url) => {
      if (String(url).includes("/storage/v1/object/")) {
        uploads.push(String(url));
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // PostgREST echoes the row it was given; mirror the gallery back.
      return new Response(JSON.stringify([productRow({ images: uploads.map((u) => u.replace("/object/", "/object/public/")) })]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    () =>
      createProduct(
        {
          name: "Galereya sinovi",
          brand: "NeoSport",
          category: "Komplekt",
          price: 500000,
          description: "Galereyani sinash uchun mahsulot.",
          sizes: ["L"],
          colors: [{ label: "Qora", hex: "#111111" }],
          images: ten,
        },
        supabaseEnvironment,
      ),
  );

  assert.equal(uploads.length, MAX_IMAGES, "every photo is uploaded separately");
  assert.equal(new Set(uploads).size, MAX_IMAGES, "each photo gets its own filename");
  assert.equal(product.images.length, MAX_IMAGES);
  assert.equal(product.imageUrl, product.images[0], "imageUrl mirrors the first photo");

  await assert.rejects(
    () =>
      createProduct(
        {
          name: "Ko‘p rasm",
          brand: "NeoSport",
          category: "Komplekt",
          price: 500000,
          description: "Chegaradan oshirish urinishi.",
          sizes: ["L"],
          colors: [{ label: "Qora", hex: "#111111" }],
          images: [...ten, ten[0]],
        },
        supabaseEnvironment,
      ),
    /Ko‘pi bilan 10 ta rasm/,
  );
});

test("the shop renders a gallery and the admin panel manages one", () => {
  // Thumbnails only appear when there is more than one photo.
  assert.match(script, /product\.images\.length > 1/);
  assert.match(script, /data-thumb=/);
  assert.match(shopCss, /\.pdp-thumb \{/);

  assert.match(read("admin-product.html"), /name="image-file"[^>]*multiple/);
  assert.match(read("admin-product.html"), /id="image-gallery"/);
  assert.match(read("admin-product.js"), /const renderImageGallery = /);
  assert.match(read("admin-product.js"), /data-make-main/);
  assert.match(read("admin.css"), /\.image-tile \{/);

  // A single photo saved before the gallery existed still has to render.
  assert.match(read("supabase-schema.sql"), /jsonb_build_array\(image_url\)/);
});

test("footwear is sized in EU numbers and clothing in letters", () => {
  const adminScript = read("admin-product.js");
  const adminHtml = read("admin-product.html");

  // Both sets exist, and the size set now follows the category record rather
  // than a hard-coded list of names.
  assert.match(adminScript, /shoes: \["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"\]/);
  assert.match(adminScript, /clothing: \["S", "M", "L", "XL", "2XL", "3XL", "4XL"\]/);
  assert.match(adminScript, /findCategory\(category\)\?\.sizeType === "shoes"/);
  assert.match(adminHtml, /<select name="category" id="product-category" required>/);
  assert.match(adminScript, /const renderCategoryOptions = /);

  const categoryService = read("category-service.mjs");
  for (const category of ["Krossovka", "Botinka", "Shippak"]) {
    assert.match(
      categoryService,
      new RegExp(`\\{ name: "${category}", sizeType: "shoes" \\}`),
      `${category} must be seeded as footwear`,
    );
  }

  // Changing category re-renders the list rather than leaving stale boxes.
  assert.match(adminScript, /const renderSizeChecks = /);
  assert.match(adminScript, /namedItem\("category"\)\.addEventListener\("change"/);

  // The server accepts numeric sizes as readily as letter ones.
  const service = read("product-service.mjs");
  assert.match(service, /\/\^\[A-Z0-9\]\{1,4\}\$\//);
  assert.match(read("script.js"), /\/\^\[A-Z0-9\]\{1,4\}\$\//);
});

test("categories are managed from their own admin section", async () => {
  const adminHtml = read("admin-categories.html");
  const adminScript = read("admin-categories.js");

  // Each task lives in its own document.
  assert.match(adminHtml, /<section class="category-section"/);
  assert.match(adminHtml, /id="category-list"/);
  assert.match(adminHtml, /data-admin-view="categories"/);
  assert.match(read("admin-product.html"), /data-admin-view="editor"/);
  assert.match(read("admin-products.html"), /data-admin-view="products"/);
  assert.match(adminScript, /const renderCategories = /);
  assert.match(adminScript, /\/api\/admin\/categories/);
  assert.match(read("admin.css"), /\.admin-category \{/);
  assert.match(read("supabase-schema.sql"), /create table if not exists public\.categories/);

  const environment = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  };
  const categoryRows = [
    { id: "category-1", name: "Krossovka", size_type: "shoes", position: 0, active: true, created_at: "2026-01-01T00:00:00.000Z" },
  ];

  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const originalFetch = globalThis.fetch;
  let productRows = [];
  let productPatch = null;

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";

    if (target.includes("/rest/v1/categories")) {
      if (method === "GET") return json(categoryRows);
      if (method === "PATCH") return json([{ ...categoryRows[0], ...JSON.parse(options.body) }]);
      if (method === "DELETE") return new Response(null, { status: 204 });
    }
    if (target.includes("/rest/v1/products")) {
      if (method === "PATCH") {
        productPatch = { target, body: JSON.parse(options.body) };
        return json(productRows);
      }
      return json(productRows);
    }
    throw new Error(`unexpected request to ${target}`);
  };

  try {
    // A rename has to travel to every product wearing the old category name,
    // because products store it as text.
    productRows = [{ id: "product-1" }];
    const renamed = await updateCategory("category-1", { name: "Krossovkalar", sizeType: "shoes" }, environment);
    assert.equal(renamed.name, "Krossovkalar");
    assert.match(productPatch.target, /category=eq\.Krossovka/);
    assert.equal(productPatch.body.category, "Krossovkalar");

    // Two categories with the same name would make the product select ambiguous.
    await assert.rejects(
      () => createCategory({ name: "krossovka", sizeType: "shoes" }, environment),
      /allaqachon mavjud/,
    );

    // Deleting a category in use would strand those products on a label the
    // panel no longer offers.
    await assert.rejects(() => deleteCategory("category-1", environment), /1 ta mahsulot/);

    productRows = [];
    await assert.doesNotReject(() => deleteCategory("category-1", environment));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* -------------------------------------------------------- Telegram login -- */

test("phone numbers match however they are written", () => {
  for (const spelling of ["+998 90 123 45 67", "998901234567", "90 123 45 67", "(90) 123-45-67"]) {
    assert.equal(normalizePhone(spelling), "998901234567", `${spelling} must normalise`);
  }
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(null), "");

  const environment = { ADMIN_PHONES: "+998 90 123 45 67, 998911112233" };
  assert.equal(isAdminPhone("998901234567", environment), true);
  assert.equal(isAdminPhone("901234567", environment), true, "a local nine-digit number is the same person");
  assert.equal(isAdminPhone("998900000000", environment), false);
  assert.equal(isAdminPhone("", environment), false);
});

test("a Telegram session carries a phone instead of an email", () => {
  const environment = {
    SESSION_SECRET: "a-test-secret-that-is-long-enough-to-pass",
    ADMIN_PHONES: "998901234567",
  };
  const telegramUser = { id: "tg:551", phone: "998901234567", name: "Pax", email: "", picture: "" };
  const cookie = asCookieHeader(createSessionCookie(telegramUser, { environment }));

  const session = readSession(fakeRequest({ cookie }), environment);
  assert.equal(session.id, "tg:551");
  assert.equal(session.phone, "998901234567");
  assert.equal(session.email, "");
  assert.equal(session.role, "admin");

  // Same rule as email: dropping the number revokes admin immediately.
  const demoted = readSession(fakeRequest({ cookie }), { ...environment, ADMIN_PHONES: "998900000000" });
  assert.equal(demoted.role, "customer");

  // A session with neither an email nor a phone is not a session.
  const empty = createSessionCookie({ id: "x", email: "", phone: "" }, { environment });
  assert.equal(readSession(fakeRequest({ cookie: asCookieHeader(empty) }), environment), null);
});

test("the Telegram webhook refuses anything without the shared secret", () => {
  const environment = { TELEGRAM_WEBHOOK_SECRET: "a-webhook-secret-value" };

  assert.doesNotThrow(() =>
    verifyWebhookSecret(fakeRequest({ "x-telegram-bot-api-secret-token": "a-webhook-secret-value" }), environment),
  );
  assert.throws(
    () => verifyWebhookSecret(fakeRequest({ "x-telegram-bot-api-secret-token": "wrong" }), environment),
    /mos kelmadi/,
  );
  assert.throws(() => verifyWebhookSecret(fakeRequest({}), environment), /mos kelmadi/);

  // With no secret configured the endpoint is closed, not open.
  assert.throws(
    () => verifyWebhookSecret(fakeRequest({ "x-telegram-bot-api-secret-token": "anything" }), {}),
    /sozlanmagan/,
  );

  assert.equal(isTelegramAuthConfigured({}), false);

  // An unconfigured bot reports 503 "not set up", never a 502 network error.
  assert.rejects(() => callTelegram("getMe", {}, {}), (error) => error.status === 503 && /sozlanmagan/.test(error.message));
  assert.equal(
    isTelegramAuthConfigured({
      TELEGRAM_BOT_TOKEN: "123:abc",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
      TELEGRAM_WEBHOOK_SECRET: "a-webhook-secret-value",
      SESSION_SECRET: "a-session-secret-that-is-long-enough",
    }),
    true,
  );
});

test("the Telegram flow is stateless and only accepts your own contact", () => {
  const webhook = read("api/telegram/webhook.mjs");

  // /start and the shared contact arrive as separate webhook calls that may run
  // on different instances, so the link between them lives in the database.
  assert.match(webhook, /attachChatToToken/);
  assert.match(webhook, /findPendingTokenForChat/);
  assert.doesNotMatch(webhook, /new Map\(\)/, "no in-memory state between webhook calls");

  // Sharing somebody else's contact card must not sign you in as them.
  assert.match(webhook, /contact\.user_id[\s\S]{0,80}message\.from\?\.id/);

  // A token is spent once: the update is filtered on the status it must have.
  assert.match(read("telegram-auth.mjs"), /status=eq\.verified/);
  assert.match(read("telegram-auth.mjs"), /status: "used"/);

  // The pages offer whichever methods the server reports.
  assert.match(read("auth-routes.mjs"), /telegramEnabled/);
  assert.match(read("admin-shell.js"), /telegramSignin/);
  assert.match(script, /data-telegram-signin/);
});

test("sharing a contact registers the customer once and refreshes them after that", async () => {
  const supabase = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };
  const calls = [];

  const run = (known) =>
    withStubbedFetch(async (url, options) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body, prefer: options.headers?.Prefer });
      if ((options.method || "GET") === "GET") {
        return new Response(JSON.stringify(known ? [{ id: known }] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 201 });
    }, () => registerTelegramUser({ chatId: 55, phone: "+998 90 123 45 67", name: "Sinov" }, supabase));

  const first = await run(null);
  assert.equal(first.id, telegramUserId(55));
  assert.equal(first.isNew, true, "an unknown chat is a sign-up");

  const write = calls.find((call) => call.method === "POST");
  const row = JSON.parse(write.body);
  assert.equal(row.phone, "998901234567", "every spelling of the number is stored the same way");
  assert.equal(row.id, "tg:55");
  assert.ok(!("created_at" in row), "the sign-up date must survive a later sign-in");
  assert.match(write.prefer, /merge-duplicates/, "two taps of the button must merge, not collide");

  const second = await run("tg:55");
  assert.equal(second.isNew, false, "a known chat is signing in, not signing up");

  // A registration that cannot be written must not cost the customer the
  // sign-in the session cookie already grants them.
  const webhook = read("api/telegram/webhook.mjs");
  assert.match(webhook, /catch[\s\S]{0,120}could not be registered/);
  assert.match(webhook, /Ro‘yxatdan o‘tdingiz/);
});

test("a verified phone number reaches the checkout form and the order behind it", () => {
  // The point of asking for the contact is that the customer never retypes it.
  assert.match(script, /namedItem\("phone"\)[\s\S]{0,120}account\.phone/);
  assert.match(script, /const formatPhone =/);

  // An order placed by a Telegram account is attributable to it: Google has an
  // email, Telegram a phone, and the notification names whichever signed in.
  assert.match(read("order-service.mjs"), /userPhone: user\?\.phone \|\| null/);
  assert.match(read("order-service.mjs"), /user\?\.email \|\| \(user\?\.phone/);
  assert.match(read("order-store.mjs"), /user_phone: order\.userPhone/);
  assert.match(read("supabase-schema.sql"), /add column if not exists user_phone text/);

  // The registration table and the id orders carry must stay the same value.
  assert.match(read("supabase-schema.sql"), /create table if not exists public\.users/);
  assert.equal(telegramUserId(7), "tg:7");
  assert.match(read("telegram-auth.mjs"), /id: telegramUserId\(used\.chat_id\)/);
});

test("a minimal Supabase response is not mistaken for a failure", async () => {
  // Inserts sent with `Prefer: return=minimal` come back 201 with no body.
  // Parsing that unconditionally threw, which silently lost every stored order.
  const config = { url: "https://x.supabase.co", serviceKey: "key" };

  for (const [status, body] of [
    [201, ""],
    [204, null],
    [200, JSON.stringify([{ id: 1 }])],
  ]) {
    const result = await withStubbedFetch(
      async () => new Response(body, { status, headers: body ? { "Content-Type": "application/json" } : {} }),
      () => supabaseRequest(config, "/rest/v1/anything", { method: "POST" }),
    );
    if (status === 200) assert.deepEqual(result, [{ id: 1 }]);
    else assert.equal(result, null, `${status} with an empty body must resolve, not throw`);
  }
});

test("every /api/auth path is served by one Serverless Function", async () => {
  const { resolveAction } = await import("../api/auth.mjs");
  const { authRoutes } = await import("../auth-routes.mjs");

  // Vercel's Hobby plan allows twelve functions per deployment, and going over
  // fails the whole deploy rather than just the new endpoint.
  const functions = readdirSync(join(root, "api"), { recursive: true }).filter((name) => String(name).endsWith(".mjs"));
  assert.ok(functions.length <= 12, `${functions.length} functions is over the limit`);
  assert.ok(functions.includes("auth.mjs"));

  // The rewrite hands the rest of the path over as ?action=…
  assert.match(read("vercel.json"), /"\/api\/auth\/\(\.\*\)"[\s\S]*?"\/api\/auth\?action=\$1"/);

  for (const [path, action] of [
    ["/api/auth?action=login", "login"],
    ["/api/auth?action=telegram/status&next=%2Fshop", "telegram/status"],
    ["/api/auth/login?next=/admin", "login"],
    ["/api/auth/telegram/start", "telegram/start"],
    ["/api/auth/me", "me"],
  ]) {
    assert.equal(resolveAction({ url: path }), action, `${path} must resolve to ${action}`);
  }

  // Every action the pages call has a handler, and nothing else does.
  for (const action of ["login", "callback", "logout", "me", "telegram/start", "telegram/status"]) {
    assert.equal(typeof authRoutes[action], "function", `${action} is missing`);
  }
  // An action named after an Object.prototype member must not resolve.
  for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(authRoutes[inherited], undefined, `${inherited} must not resolve as a route`);
  }
  assert.match(read("api/auth.mjs"), /Object\.hasOwn\(authRoutes, action\)/);
});
