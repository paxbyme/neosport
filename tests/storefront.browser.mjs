import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

// Browser tooling is optional and never included in the production build.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const base = process.env.STOREFRONT_URL || "http://localhost:4173";
const output = new URL("../docs/ui-review/", import.meta.url).pathname;
mkdirSync(output, { recursive: true });
const results = [];
const capture = async (page, options) => {
  await page.waitForFunction(() => [...document.images].filter(img => {
    const r = img.getBoundingClientRect();
    return r.width && r.height && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
  }).every(img => img.complete && img.naturalWidth > 0));
  await page.evaluate(async () => {
    const visibleImages = [...document.images].filter(img => {
      const r = img.getBoundingClientRect();
      return r.width && r.height && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
    });
    await Promise.all(visibleImages.map(img => img.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot(options);
};
const waitFor = async (page, fn) => page.waitForFunction(fn);
const assertNoOverflow = async (page) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator("button button, button a, a button").count(), 0);
};

try {
  for (const width of [360, 390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Every order request is intercepted, including validation and success tests.
    let orderMode = "error";
    let orderRequests = 0;
    await context.route("**/api/order", async route => {
      orderRequests += 1;
      assert.equal(route.request().method(), "POST");
      const body = route.request().postDataJSON();
      assert.ok(body.items.length > 0);
      assert.equal(body.name, "Sinov");
      await route.fulfill({ status: orderMode === "error" ? 503 : 200, json: orderMode === "error" ? { message: "Hozir yuborib bo‘lmadi. Qayta urinib ko‘ring." } : { ok: true, orderId: "UI-SINOV" } });
    });
    await context.route("**/_vercel/insights/**", route => route.fulfill({ body: "", contentType: "text/javascript" }));
    await page.goto(`${base}/shop`, { waitUntil: "networkidle" });
    await page.locator(".catalog-card").first().waitFor();
    const response = await context.request.get(`${base}/api/products`);
    const { products } = await response.json();
    assert.ok(products.length > 0, "A real catalog is required for this review.");
    const product = products[0];
    await page.evaluate(() => document.fonts.ready);
    await assertNoOverflow(page);
    const gridTracks = await page.locator(".catalog-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.equal(gridTracks, width >= 1440 ? 3 : 2);
    assert.equal(await page.locator(".catalog-card img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0 && !img.dataset.fallback)), true);
    assert.equal(await page.locator(".catalog-card-price small").first().textContent(), "so‘m");
    await capture(page, { path: `${output}shop-${width}.png`, fullPage: true });

    await page.locator("#catalog-search").fill(product.brand.toLowerCase());
    assert.equal(await page.locator(".catalog-card").count(), products.filter(p => p.brand.toLowerCase().includes(product.brand.toLowerCase()) || p.name.toLowerCase().includes(product.brand.toLowerCase())).length);
    await page.locator("#catalog-search").fill("mavjud-emas-123456");
    assert.equal(await page.locator(".catalog-card").count(), 0);
    assert.match(await page.locator("#catalog-empty").innerText(), /Mos mahsulot topilmadi/);
    await page.locator("[data-reset-filters]").click();
    assert.equal(await page.locator(".catalog-card").count(), products.length);
    await page.locator(".category-chip").filter({ hasText: product.category }).click();
    assert.equal(await page.locator(".catalog-card").count(), products.filter(p => p.category === product.category).length);
    await page.locator("#reset-filters").click();
    await page.locator("#catalog-sort").selectOption("price-asc");
    assert.equal(await page.locator(".catalog-card-action").first().getAttribute("data-open-product"), [...products].sort((a,b) => a.finalPrice-b.finalPrice)[0].id);

    if (width < 768) {
      await page.locator(".menu-toggle").click();
      assert.equal(await page.locator("#site-nav").getAttribute("aria-modal"), "true");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.locator("#site-nav").evaluate(el => el.contains(document.activeElement)), true);
    }
    await page.locator("#size-filter").selectOption(product.sizes[0]);
    if (width < 768) {
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".menu-toggle").evaluate(el => el === document.activeElement), true);
    }
    assert.equal(await page.locator(".catalog-card").count(), products.filter(p => p.sizes.includes(product.sizes[0])).length);
    await page.locator("#reset-filters").click();

    const trigger = page.locator(`.catalog-card-action[data-open-product="${product.id}"]`);
    await trigger.click();
    await page.locator(".product-modal.is-open").waitFor();
    assert.equal(await page.locator(".product-modal-close").evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator("#product-modal").evaluate(el => el.contains(document.activeElement)), true);
    await page.locator(".shop-add-button").dispatchEvent("click");
    assert.equal(await page.locator(".cart-item").count(), 0);
    assert.match(await page.locator("#modal-form-status").innerText(), /o‘lchamni tanlang/);
    await page.locator('input[name="size"]').first().check();
    if (product.images.length > 1) {
      await page.locator(".pdp-thumb").nth(1).click();
      assert.equal(await page.locator("#modal-product-image").getAttribute("src"), product.images[1]);
      assert.equal(await page.locator(".pdp-thumb").nth(1).getAttribute("aria-pressed"), "true");
    }
    if (width === 390 || width === 1440) await capture(page, { path: `${output}product-${width}.png` });
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await trigger.click();
    await page.locator('input[name="size"]').first().check();
    await page.locator('[data-quantity-action="increase"]').click();
    await page.locator(".shop-add-button").click();
    await page.locator(".cart-item").waitFor();
    assert.equal(await page.locator(".cart-quantity span").textContent(), "2");
    assert.equal(await page.locator("#cart-drawer").getAttribute("role"), width >= 1200 ? "complementary" : "dialog");
    await page.locator('[data-cart-action="increase"]').click();
    assert.equal(await page.locator(".cart-quantity span").textContent(), "3");
    assert.equal(await page.locator('[data-cart-action="increase"]').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-cart-action="decrease"]').click();
    await assertNoOverflow(page);
    if (width === 390 || width === 1440) await capture(page, { path: `${output}cart-${width}.png` });
    if (width < 1200) {
      await page.keyboard.press("Escape");
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    }
    await page.reload({ waitUntil: "networkidle" });
    if (width < 1200) await page.locator(".cart-toggle").click();
    assert.equal(await page.locator(".cart-quantity span").textContent(), "2");
    await page.locator("#checkout-button").click();
    assert.equal(orderRequests, 0);
    await page.locator('input[name="name"]').fill("Sinov");
    await page.locator('input[name="phone"]').fill("+998 90 000 00 00");
    await page.locator("#checkout-button").click();
    await waitFor(page, () => document.querySelector("#checkout-status").textContent.includes("Hozir yuborib"));
    assert.equal(await page.locator(".cart-item").count(), 1);
    orderMode = "success";
    await page.locator("#checkout-button").click();
    await waitFor(page, () => document.querySelector("#checkout-status").textContent.includes("UI-SINOV"));
    assert.equal(await page.locator(".cart-item").count(), 0);
    assert.equal(orderRequests, 2);
    assert.equal(await page.locator("#checkout-button").isDisabled(), true);
    if (width < 1200) await page.locator(".cart-close").click();

    // Both authentication entry points retain their real destinations.
    await page.route("**/api/auth/me", route => route.fulfill({ json: { user: null, googleEnabled: true, telegramEnabled: true } }));
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator(".catalog-card").first().waitFor();
    await assertNoOverflow(page);
    assert.equal(await page.locator('[aria-label="Google orqali kirish"]').getAttribute("href"), "/api/auth/login?next=%2F");
    assert.equal(await page.locator('[data-telegram-signin]').getAttribute("href"), "/api/auth/telegram/start?next=%2F");
    await page.unroute("**/api/auth/me");
    await page.reload({ waitUntil: "networkidle" });
    await capture(page, { path: `${output}home-${width}.png`, fullPage: true });
    if (width === 390 || width === 1440) await capture(page, { path: `${output}home-viewport-${width}.png` });
    if (width <= 900) {
      await page.locator(".menu-toggle").click();
      await page.locator(".landing-menu-close").click();
      assert.equal(await page.locator(".menu-toggle").evaluate(el => el === document.activeElement), true);
    }
    await page.locator(".catalog-card-action").first().click();
    await page.locator('input[name="size"]').first().check();
    await page.locator(".shop-add-button").click();
    await page.locator('[data-cart-action="remove"]').click();
    assert.equal(await page.locator(".cart-item").count(), 0);
    assert.deepEqual(errors, []);
    results.push({ width, status: "passed", realProducts: products.length, checks: "layout, images, search, category, size, sorting, keyboard, gallery, required selections, quantity, cart persistence, removal, intercepted checkout, auth links, homepage" });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await page.route("**/api/order", route => route.abort());
  await page.route("**/_vercel/insights/**", route => route.fulfill({ body: "", contentType: "text/javascript" }));
  const live = await (await page.request.get(`${base}/api/products`)).json();
  const manyItems = live.products.flatMap(product => product.sizes.map(size => ({ productId: product.id, color: product.colors[0].id, size, quantity: 1 })));
  await page.goto(`${base}/shop`, { waitUntil: "networkidle" });
  await page.evaluate(items => localStorage.setItem("neosport-cart-v1", JSON.stringify(items)), manyItems);
  let mode = "error";
  let unblock;
  await page.route("**/api/products", async route => {
    if (mode === "loading") await new Promise(resolve => { unblock = resolve; });
    return route.fulfill(mode === "error" ? { status: 503, json: {} } : { json: mode === "empty" ? { products: [] } : live });
  });
  await page.goto(`${base}/shop`, { waitUntil: "networkidle" });
  assert.match(await page.locator("#catalog-empty").innerText(), /Mahsulotlar yuklanmadi/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("neosport-cart-v1")).length), manyItems.length);
  mode = "loading";
  await page.locator("[data-catalog-retry]").click();
  assert.equal(await page.locator("#catalog-grid").getAttribute("aria-busy"), "true");
  await page.waitForFunction(() => document.querySelectorAll(".catalog-skeleton").length > 0);
  mode = "live";
  while (!unblock) await new Promise(resolve => setTimeout(resolve, 20));
  unblock();
  await page.locator(".catalog-card").first().waitFor();
  assert.equal(await page.locator(".cart-item").count(), manyItems.length);
  await page.locator(".cart-toggle").click();
  await page.locator("#checkout-button").scrollIntoViewIfNeeded();
  const closeBox = await page.locator(".cart-close").boundingBox();
  assert.ok(closeBox.y >= 0 && closeBox.y < 844);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector("#cart-drawer").getAttribute("role") === "complementary");
  assert.equal(await page.locator("#cart-drawer").getAttribute("role"), "complementary");
  await page.locator(".cart-content").evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.ok((await page.locator("#checkout-button").boundingBox()).y < 900);
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForFunction(() => document.querySelector("#cart-drawer").getAttribute("role") === "dialog");
  await page.locator(".cart-toggle").click();
  await page.locator('input[name="phone"]').focus();
  const phoneBox = await page.locator('input[name="phone"]').boundingBox();
  assert.ok(phoneBox.y >= 76 && phoneBox.y + phoneBox.height <= 500);
  await page.locator(".cart-close").click();
  await page.setViewportSize({ width: 320, height: 700 });
  await assertNoOverflow(page);
  assert.equal(await page.locator(".catalog-grid").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 1);
  // Enlarge the catalog only in this intercepted browser response to exercise a full grid.
  const preview = live.products.slice();
  while (live.products.length < 9) live.products.push({ ...preview[live.products.length % preview.length], id: `preview-only-${live.products.length}` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".catalog-card").count(), 9);
  const cardBoxes = await page.locator(".catalog-card").evaluateAll(cards => cards.map(card => ({ top: card.getBoundingClientRect().top, height: card.getBoundingClientRect().height })));
  assert.equal(cardBoxes[0].top, cardBoxes[2].top);
  assert.ok(cardBoxes[3].top > cardBoxes[2].top);
  assert.equal(cardBoxes[0].height, cardBoxes[2].height);
  await assertNoOverflow(page);
  live.products = preview;
  mode = "empty";
  await page.reload({ waitUntil: "networkidle" });
  assert.match(await page.locator("#catalog-empty").innerText(), /Yangi modellar tez orada/);
  assert.doesNotMatch(await page.locator("#catalog-empty").innerText(), /admin/i);
  results.push({ status: "passed", checks: "catalog loading, error, retry, empty, saved cart retained after fetch failure, long cart, responsive cart transitions, short viewport input focus, 320px single column, isolated nine-product grid" });
  writeFileSync(`${output}results.json`, JSON.stringify(results, null, 2) + "\n");
  console.log("All storefront browser checks passed. No order reached the server.");
} finally { await browser.close(); }
