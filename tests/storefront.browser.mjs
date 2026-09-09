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
  const controls = await page.evaluate(() => [...document.querySelectorAll("button,a[href],input,select")].filter(el => el.getClientRects().length && !el.closest('[inert],[aria-hidden="true"]') && !el.disabled && getComputedStyle(el).visibility !== "hidden").flatMap(el => {
    const box = (el.matches('input[type="radio"]') ? el.closest("label") : el).getBoundingClientRect();
    const named = el.getAttribute("aria-label") || el.textContent.trim() || el.labels?.length;
    return box.width < 44 || box.height < 44 || !named ? [{ element: el.outerHTML.slice(0,150), width: box.width, height: box.height, named: Boolean(named) }] : [];
  }));
  assert.deepEqual(controls, [], "Accessible labels and 44px touch targets");
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
    await capture(page, { path: `${output}shop-${width}.png`, fullPage: true });
    assert.equal(await page.locator(".catalog-card img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0 && !img.dataset.fallback)), true);
    assert.equal(await page.locator(".catalog-card-price small").first().textContent(), "so‘m");

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
    await page.locator("#catalog-sort").selectOption("price-desc");
    assert.equal(await page.locator(".catalog-card-action").first().getAttribute("href"), `/products/${[...products].sort((a,b) => b.finalPrice-a.finalPrice)[0].id}`);
    await page.locator("#catalog-sort").selectOption("name");
    assert.equal(await page.locator(".catalog-card-action").first().getAttribute("href"), `/products/${[...products].sort((a,b) => a.name.localeCompare(b.name,"uz",{numeric:true}))[0].id}`);
    await page.locator("#catalog-sort").selectOption("price-asc");
    assert.equal(await page.locator(".catalog-card-action").first().getAttribute("href"), `/products/${[...products].sort((a,b) => a.finalPrice-b.finalPrice)[0].id}`);

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

    // The card is a link: image, title and action all address the same page,
    // and every product's address is its own.
    const address = `/products/${product.id}`;
    for (const selector of [".catalog-card-trigger", ".catalog-card-name a", ".catalog-card-action"]) {
      assert.equal(await page.locator(`.catalog-card`).first().locator(selector).getAttribute("href"), `/products/${products[0].id}`);
    }
    assert.equal(new Set(await page.locator(".catalog-card-action").evaluateAll(links => links.map(link => link.getAttribute("href")))).size, products.length);
    assert.equal(await page.locator(".product-modal, [data-open-product]").count(), 0, "the popup is gone");

    const trigger = page.locator(`.catalog-card-action[href="${address}"]`);
    await trigger.click();
    await page.waitForURL(`${base}${address}`);
    await page.locator(".pdp").waitFor();
    assert.equal(await page.locator("#product-name").innerText(), product.name);
    assert.equal(await page.title(), `${product.name} — NeoSport`);
    await assertNoOverflow(page);
    await page.locator(".shop-add-button").dispatchEvent("click");
    assert.equal(await page.locator(".cart-item").count(), 0);
    assert.match(await page.locator("#product-form-status").innerText(), /o‘lchamni tanlang/);
    await page.locator('input[name="size"]').first().check();
    if (product.images.length > 1) {
      await page.locator(".pdp-thumb").nth(1).click();
      assert.equal(await page.locator("#product-image").getAttribute("src"), product.images[1]);
      assert.equal(await page.locator(".pdp-thumb").nth(1).getAttribute("aria-pressed"), "true");
    }
    if (width === 390 || width === 1440) await capture(page, { path: `${output}product-${width}.png`, fullPage: true });

    // A share is a plain GET with no script: the head has to name the product
    // before the browser ever runs, or a link preview shows the generic shop.
    const shared = await context.request.get(`${base}${address}`);
    const head = await shared.text();
    assert.equal(shared.status(), 200);
    assert.equal(head.match(/<title>([^<]*)<\/title>/)[1], `${product.name} — NeoSport`);
    assert.match(head, new RegExp(`<meta property="og:url" content="[^"]*${address}"`));
    assert.ok(head.match(/<meta property="og:image" content="(https?:\/\/[^"]+)"/), "og:image is a whole address");
    assert.equal((await context.request.get(`${base}/products/product-0000ffff-0000-ffff-0000-ffff0000ffff`)).status(), 404);

    // The address alone is enough: a refresh, a direct visit and a share all
    // land on the same product, and an unknown one says so.
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#product-name").innerText(), product.name);
    if (products.length > 1) {
      await page.goto(`${base}/products/${products[1].id}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#product-name").innerText(), products[1].name);
    }
    await page.goto(`${base}/products/product-0000ffff-0000-ffff-0000-ffff0000ffff`, { waitUntil: "networkidle" });
    await page.locator(".product-missing").waitFor();
    if (width === 390 || width === 1440) await capture(page, { path: `${output}product-missing-${width}.png` });

    // Back through the visited products returns to the catalog.
    await page.goBack({ waitUntil: "networkidle" });
    if (products.length > 1) await page.goBack({ waitUntil: "networkidle" });
    await page.goBack({ waitUntil: "networkidle" });
    await page.waitForURL(`${base}/shop`);
    await page.locator(".catalog-card").first().waitFor();

    await page.goto(`${base}${address}`, { waitUntil: "networkidle" });
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
    if (width < 1200) await page.keyboard.press("Escape");
    await page.goto(`${base}/shop`, { waitUntil: "networkidle" });
    await page.locator(".catalog-card").first().waitFor();
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
    assert.equal(await page.locator('a[href="/admin"]').count(), 0);
    for (const target of ["new", "collection", "about", "store"]) assert.equal(await page.locator(`#${target}`).count(), 1);
    assert.equal(await page.locator('.hero-actions [href="/shop"]').count(), 1);
    assert.ok(await page.locator('a[href="https://yandex.uz/maps/-/CTgRbPmH"]').count() > 0);
    assert.ok(await page.locator('a[href="https://www.instagram.com/neosport_namangan/"]').count() > 0);
    await page.unroute("**/api/auth/me");
    await page.reload({ waitUntil: "networkidle" });
    assert.ok(await page.locator("#new").evaluate(el => el.getBoundingClientRect().top < innerHeight), "Next section starts within the first viewport");
    await capture(page, { path: `${output}home-${width}.png`, fullPage: true });
    if (width === 390 || width === 1440) await capture(page, { path: `${output}home-viewport-${width}.png` });
    if (width <= 900) {
      await page.locator(".menu-toggle").click();
      await page.locator(".landing-menu-close").click();
      assert.equal(await page.locator(".menu-toggle").evaluate(el => el === document.activeElement), true);
    }
    for (const target of ["new", "collection", "about", "store"]) {
      if (width <= 900) await page.locator(".menu-toggle").click();
      await page.locator(`.site-nav a[href="#${target}"]`).click();
      assert.equal(new URL(page.url()).hash, `#${target}`);
      const targetBox = await page.locator(`#${target}`).boundingBox();
      assert.ok(targetBox.y >= 0 && targetBox.y < page.viewportSize().height);
    }
    await page.locator(".catalog-card-action").first().click();
    await page.locator('input[name="size"]').first().check();
    await page.locator(".shop-add-button").click();
    await page.locator('[data-cart-action="remove"]').click();
    assert.equal(await page.locator(".cart-item").count(), 0);
    assert.deepEqual(errors, []);
    results.push({ width, status: "passed", realProducts: products.length, checks: "layout, images, search, category, size, sorting, keyboard, product page links, server-rendered share metadata, direct URL, refresh, back navigation, not found, gallery, required selections, quantity, cart persistence, removal, intercepted checkout, auth links, homepage" });
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
  assert.match(await page.locator("#catalog-empty").innerText(), /Hozircha mahsulot yo‘q/);
  assert.doesNotMatch(await page.locator("#catalog-empty").innerText(), /admin/i);
  results.push({ status: "passed", checks: "catalog loading, error, retry, empty, saved cart retained after fetch failure, long cart, responsive cart transitions, short viewport input focus, 320px single column, isolated nine-product grid" });
  const signed = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await signed.route("**/api/order", route => route.abort());
  await signed.route("**/_vercel/insights/**", route => route.fulfill({ body: "", contentType: "text/javascript" }));

  // Two customers behind one browser. The account the shop is told about and
  // the history it is given always belong to the same person, so anything from
  // the other one appearing on the page is a leak.
  const accounts = {
    anvar: { user: { name: "Anvar", phone: "998901111111", role: "customer" }, orders: [{ id: "SINOV-ANVAR", createdAt: "2026-09-08T09:00:00Z", total: preview[0].finalPrice, items: [{ name: preview[0].name, color: preview[0].colors[0].label, size: preview[0].sizes[0], quantity: 1 }] }] },
    bekzod: { user: { name: "Bekzod", phone: "998902222222", role: "customer" }, orders: [{ id: "SINOV-BEKZOD", createdAt: "2026-09-09T09:00:00Z", total: preview[0].finalPrice, items: [{ name: preview[0].name, color: preview[0].colors[0].label, size: preview[0].sizes[0], quantity: 2 }] }] },
    none: { user: null, orders: null },
  };
  let signedIn = "anvar";
  await signed.route("**/api/auth/me", route => route.fulfill({ json: { user: accounts[signedIn].user, googleEnabled: true, telegramEnabled: false } }));
  await signed.route("**/api/orders**", route => accounts[signedIn].orders
    ? route.fulfill({ json: { orders: accounts[signedIn].orders } })
    : route.fulfill({ status: 401, json: { ok: false, message: "Kiring." } }));

  const signedPage = await signed.newPage();
  await signedPage.goto(`${base}/shop`, { waitUntil: "networkidle" });
  await signedPage.locator(".account-order").waitFor();
  assert.equal(await signedPage.locator('#checkout-form [name="name"]').inputValue(), "Anvar");
  assert.equal(await signedPage.locator('#checkout-form [name="phone"]').inputValue(), "+998 90 111 11 11");
  assert.match(await signedPage.locator("#account-orders-body").innerText(), /SINOV-ANVAR/);
  assert.equal(await signedPage.locator('a[href="/admin"]').count(), 0);

  // Signing out empties the section rather than leaving the last customer's
  // orders behind for whoever opens the page next.
  signedIn = "none";
  await signedPage.reload({ waitUntil: "networkidle" });
  await signedPage.waitForFunction(() => document.querySelector("#account-orders").hidden);
  assert.equal(await signedPage.locator(".account-order").count(), 0);

  signedIn = "bekzod";
  await signedPage.reload({ waitUntil: "networkidle" });
  await signedPage.locator(".account-order").waitFor();
  const afterSwitch = await signedPage.locator("#account-orders-body").innerText();
  assert.match(afterSwitch, /SINOV-BEKZOD/);
  assert.doesNotMatch(afterSwitch, /SINOV-ANVAR/, "the previous customer's history must not survive the switch");
  assert.equal(await signedPage.locator('#checkout-form [name="name"]').inputValue(), "Bekzod");

  // Neither does going back to a shop page the previous customer had open:
  // the restored page re-reads the session before it shows anything.
  await signedPage.goto(`${base}/products/${preview[0].id}`, { waitUntil: "networkidle" });
  signedIn = "anvar";
  accounts.anvar.orders = [];
  await signedPage.goBack({ waitUntil: "networkidle" });
  await signedPage.waitForURL(`${base}/shop`);
  await signedPage.waitForFunction(() => document.querySelector("#account-orders-body")?.innerText.includes("Hali buyurtma bermagansiz"));
  assert.doesNotMatch(await signedPage.locator("#account-orders-body").innerText(), /SINOV-BEKZOD/);

  await signedPage.goto(`${base}/shop`, { waitUntil: "networkidle" });
  await signedPage.waitForFunction(() => document.querySelector("#account-orders-body").innerText.includes("Hali buyurtma bermagansiz"));
  await assertNoOverflow(signedPage);
  await signed.close();
  results.push({ status: "passed", checks: "authenticated name/phone prefill, order history and empty history, customer has no admin link, order history cleared on sign-out, account switch and back navigation" });
  writeFileSync(`${output}results.json`, JSON.stringify(results, null, 2) + "\n");
  console.log("All storefront browser checks passed. No order reached the server.");
} finally { await browser.close(); }
