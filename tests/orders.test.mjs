import assert from "node:assert/strict";
import test from "node:test";
import ordersHandler from "../api/orders.mjs";
import productsHandler from "../api/products.mjs";
import productPageHandler from "../api/product-page.mjs";
import { createSessionCookie } from "../auth-session.mjs";

const environment = {
  SESSION_SECRET: "fixture-session-secret-at-least-32-characters",
  SUPABASE_URL: "https://orders-fixture.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  ADMIN_PHONES: "998900000000",
  ADMIN_EMAILS: "",
  SITE_URL: "https://neosport.example",
};

const customers = {
  anvar: { id: "tg:111", phone: "998901111111", name: "Anvar" },
  bekzod: { id: "tg:222", phone: "998902222222", name: "Bekzod" },
  admin: { id: "tg:999", phone: "998900000000", name: "Admin" },
};

const orders = [
  { id: "NS-A1", created_at: "2026-09-05T09:00:00.000Z", customer_name: "Anvar", customer_phone: "998901111111", user_id: "tg:111", items: [{ name: "Hudi", quantity: 1 }], total: 360000 },
  { id: "NS-B2", created_at: "2026-09-06T09:00:00.000Z", customer_name: "Bekzod", customer_phone: "998902222222", user_id: "tg:222", items: [{ name: "Shim", quantity: 2 }], total: 640000 },
  // Signing in is optional, so some orders belong to no account at all.
  { id: "NS-G3", created_at: "2026-09-07T09:00:00.000Z", customer_name: "Mehmon", customer_phone: "998903333333", user_id: null, items: [{ name: "Hudi", quantity: 1 }], total: 360000 },
];

const products = [
  { id: "product-one", name: "Alfa Hudi", brand: "NeoSport", category: "Hudi", price: 450000, discount_percent: 20, description: "Bir", sizes: ["M"], colors: [{ id: "color-1", label: "Qora", hex: "#111111" }], images: ["https://cdn.invalid/one.webp"], image_url: "https://cdn.invalid/one.webp", active: true },
  { id: "product-two", name: "Beta Shim", brand: "NeoSport", category: "Shim", price: 320000, discount_percent: 0, description: "Ikki", sizes: ["L"], colors: [{ id: "color-1", label: "Ko‘k", hex: "#1f3a93" }], images: ["https://cdn.invalid/two.webp"], image_url: "https://cdn.invalid/two.webp", active: true },
  { id: "product-hidden", name: "Gamma Kurtka", brand: "NeoSport", category: "Kurtka", price: 890000, discount_percent: 0, description: "Uch", sizes: ["XL"], colors: [{ id: "color-1", label: "Yashil", hex: "#2f6b3a" }], images: ["https://cdn.invalid/three.webp"], image_url: "https://cdn.invalid/three.webp", active: false },
];

const reply = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  end(body = "") { this.body = body; },
  get json() { return JSON.parse(this.body || "{}"); },
});

const cookieFor = (customer) => createSessionCookie(customer, { environment }).split(";")[0];

// The whole fixture runs against an in-memory table so no test can reach a
// real database, and every filter the handler sends is honoured exactly.
async function fixture(run) {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.host, "orders-fixture.invalid", "Every network call must use the isolated fixture");
    const table = url.pathname === "/rest/v1/orders" ? orders : url.pathname === "/rest/v1/products" ? products : null;
    assert.ok(table, `Unexpected table ${url.pathname}`);

    const rows = table.filter((row) =>
      [...url.searchParams].every(([key, filter]) =>
        ["select", "order", "limit"].includes(key) || (filter.startsWith("eq.") && String(row[key]) === filter.slice(3)),
      ),
    );
    return new Response(JSON.stringify(structuredClone(rows)), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const orderRequest = async (url, customer) => {
    const response = reply();
    await ordersHandler({ url, method: "GET", headers: { cookie: customer ? cookieFor(customer) : "" } }, response);
    return response;
  };
  const productRequest = async (url) => {
    const response = reply();
    await productsHandler({ url, method: "GET", headers: {} }, response);
    return response;
  };
  const pageRequest = async (url, headers = { host: "neosport.example" }) => {
    const response = reply();
    await productPageHandler({ url, method: "GET", headers }, response);
    return response;
  };

  try {
    await run({ orderRequest, productRequest, pageRequest });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the order list is scoped to the session and never to anything the browser sends", () =>
  fixture(async ({ orderRequest }) => {
    const anonymous = await orderRequest("/api/orders");
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.headers["cache-control"], "no-store");

    const anvar = await orderRequest("/api/orders", customers.anvar);
    assert.deepEqual(anvar.json.orders.map((order) => order.id), ["NS-A1"]);

    const bekzod = await orderRequest("/api/orders", customers.bekzod);
    assert.deepEqual(bekzod.json.orders.map((order) => order.id), ["NS-B2"]);

    // A user id in the query cannot widen or redirect the list.
    const forged = await orderRequest("/api/orders?userId=tg:222&user_id=tg:222", customers.anvar);
    assert.deepEqual(forged.json.orders.map((order) => order.id), ["NS-A1"]);

    // The listing carries no other customer's contact details.
    assert.equal(anvar.json.orders[0].customerPhone, undefined);
    assert.equal(anvar.headers["cache-control"], "no-store");
    assert.equal(anvar.headers.vary, "Cookie");
  }));

test("an order id in the URL cannot reach another customer's order", () =>
  fixture(async ({ orderRequest }) => {
    const own = await orderRequest("/api/orders/NS-A1", customers.anvar);
    assert.equal(own.statusCode, 200);
    assert.equal(own.json.order.id, "NS-A1");
    assert.equal(own.json.order.customerName, "Anvar");

    // The path form and the rewritten query form are the same request.
    for (const url of ["/api/orders/NS-B2", "/api/orders?id=NS-B2", "/api/orders/NS-B2?id=NS-B2"]) {
      const stolen = await orderRequest(url, customers.anvar);
      assert.equal(stolen.statusCode, 404, url);
      assert.equal(stolen.json.order, undefined, url);
    }

    // A guest order belongs to no account, so no account may open it.
    for (const customer of [customers.anvar, customers.bekzod]) {
      assert.equal((await orderRequest("/api/orders/NS-G3", customer)).statusCode, 404);
    }

    // A missing order and a forbidden one answer identically, so the endpoint
    // cannot be used to discover which ids exist.
    const missing = await orderRequest("/api/orders/NS-NOPE", customers.anvar);
    const forbidden = await orderRequest("/api/orders/NS-B2", customers.anvar);
    assert.equal(missing.statusCode, forbidden.statusCode);
    assert.deepEqual(missing.json, forbidden.json);

    assert.equal((await orderRequest("/api/orders/NS-A1")).statusCode, 401, "signing in comes first");
  }));

test("an admin session keeps the access it already had", () =>
  fixture(async ({ orderRequest }) => {
    // The role is recomputed from ADMIN_PHONES on every request, never read
    // from the cookie, so revoking it revokes this too.
    for (const id of ["NS-A1", "NS-B2", "NS-G3"]) {
      assert.equal((await orderRequest(`/api/orders/${id}`, customers.admin)).statusCode, 200, id);
    }
    // The list is still "my orders": the panel reads the shop's through /api/admin.
    assert.deepEqual((await orderRequest("/api/orders", customers.admin)).json.orders, []);
  }));

test("the catalog serves one product by id so a product page can render from its URL", () =>
  fixture(async ({ productRequest }) => {
    const one = await productRequest("/api/products?id=product-one");
    assert.equal(one.statusCode, 200);
    assert.equal(one.json.product.id, "product-one");
    assert.equal(one.json.product.finalPrice, 360000, "the discounted price comes from the server");

    const two = await productRequest("/api/products?id=product-two");
    assert.notEqual(two.json.product.name, one.json.product.name);

    // A product taken out of the catalog is hidden exactly like a missing one.
    const hidden = await productRequest("/api/products?id=product-hidden");
    const missing = await productRequest("/api/products?id=product-nope");
    assert.equal(hidden.statusCode, 404);
    assert.deepEqual(hidden.json, missing.json);

    // The full catalog still hides it too; only the admin endpoints see it.
    const all = await productRequest("/api/products");
    assert.deepEqual(all.json.products.map((product) => product.id), ["product-one", "product-two"]);
  }));

test("the product page is served with its own sharing metadata, for crawlers that never run the script", () =>
  fixture(async ({ pageRequest }) => {
    const head = (html, pattern) => html.match(pattern)?.[1];

    // The path form locally, the rewritten query form on Vercel.
    for (const url of ["/products/product-one", "/api/product-page?id=product-one"]) {
      const page = await pageRequest(url);
      assert.equal(page.statusCode, 200, url);
      assert.match(page.headers["content-type"], /text\/html/);
      assert.equal(head(page.body, /<title>([^<]*)<\/title>/), "Alfa Hudi — NeoSport", url);
      assert.equal(head(page.body, /<meta property="og:title" content="([^"]*)"/), "Alfa Hudi — NeoSport", url);
      assert.equal(head(page.body, /<meta property="og:url" content="([^"]*)"/), "https://neosport.example/products/product-one", url);
      assert.equal(head(page.body, /<link rel="canonical" href="([^"]*)"/), "https://neosport.example/products/product-one", url);
      // Whole addresses: a crawler cannot resolve a root-relative image.
      assert.equal(head(page.body, /<meta property="og:image" content="([^"]*)"/), "https://cdn.invalid/one.webp", url);
      // The price leads the preview, and the discounted one is the real one.
      assert.match(head(page.body, /<meta property="og:description" content="([^"]*)"/), /^360[\s\u00a0]?000 so‘m · Bir$/, url);
      // The script still runs afterwards and renders the product itself.
      assert.match(page.body, /id="product-detail"/);
      assert.match(page.body, /src="\/script\.js"/);
    }

    // Two products never share a preview.
    const two = await pageRequest("/products/product-two");
    assert.notEqual(
      head(two.body, /<meta property="og:title" content="([^"]*)"/),
      head((await pageRequest("/products/product-one")).body, /<meta property="og:title" content="([^"]*)"/),
    );

    // Missing and withdrawn products are a 404 that still renders the page.
    for (const url of ["/products/product-hidden", "/products/product-nope", "/api/product-page"]) {
      const gone = await pageRequest(url);
      assert.equal(gone.statusCode, 404, url);
      assert.match(gone.body, /id="product-detail"/, url);
      assert.equal(head(gone.body, /<title>([^<]*)<\/title>/), "Mahsulot — NeoSport", url);
    }

    // Nothing a product carries can break out of an attribute.
    products.push({ ...products[0], id: "product-quoted", name: 'Alfa " onerror=x <b>', description: "5 & 6", active: true });
    const escaped = await pageRequest("/products/product-quoted");
    assert.match(escaped.body, /<meta property="og:title" content="Alfa &quot; onerror=x &lt;b&gt; — NeoSport"/);
    assert.match(escaped.body, /content="[^"]*5 &amp; 6"/);
    // The quote never closes the attribute early and the tag never becomes markup.
    assert.doesNotMatch(escaped.body, /content="[^"]*<b>/);
    assert.equal(escaped.body.includes("<b>"), false);
    assert.match(escaped.body, /<title>Alfa &quot; onerror=x &lt;b&gt; — NeoSport<\/title>/);
    products.pop();

    // A POST is not a page request.
    const posted = reply();
    await productPageHandler({ url: "/products/product-one", method: "POST", headers: {} }, posted);
    assert.equal(posted.statusCode, 405);
    assert.equal(posted.headers.allow, "GET");
  }));
