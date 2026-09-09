import assert from "node:assert/strict";
import test from "node:test";
import adminsHandler from "../api/admin/admins.mjs";
import statsHandler from "../api/admin/stats.mjs";
import { requireAdmin } from "../admin-auth.mjs";
import { adminKey, isStoredAdmin } from "../admin-service.mjs";
import { createSessionCookie } from "../auth-session.mjs";
import { resetRateLimits } from "../rate-limit.mjs";

const environment = {
  SESSION_SECRET: "fixture-session-secret-at-least-32-characters",
  SUPABASE_URL: "https://admins-fixture.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  ADMIN_EMAILS: "boss@neosport.uz",
  ADMIN_PHONES: "998900000000",
};

const people = {
  boss: { id: "g:1", email: "boss@neosport.uz", name: "Boss" },
  rootPhone: { id: "tg:900", phone: "998900000000", name: "Root" },
  managerEmail: { id: "g:2", email: "manager@neosport.uz", name: "Manager" },
  managerPhone: { id: "tg:222", phone: "998902222222", name: "Menejer" },
  customer: { id: "tg:333", phone: "998903333333", name: "Mijoz" },
};

const reply = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  end(body = "") { this.body = body; },
  get json() { return JSON.parse(this.body || "{}"); },
});

const cookieFor = (person) => createSessionCookie(person, { environment }).split(";")[0];

async function fixture(run) {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  resetRateLimits();

  let rows = [];
  let failDatabase = false;
  const requests = [];

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.host, "admins-fixture.invalid", "Every call must use the isolated fixture");
    const method = options.method || "GET";
    requests.push({ path: url.pathname, query: url.search, method });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (failDatabase) return json({ message: "fixture unavailable" }, 503);
    if (url.pathname !== "/rest/v1/admins") return json([]);

    if (method === "POST") {
      rows.push({ created_at: new Date().toISOString(), ...JSON.parse(options.body) });
      return new Response(null, { status: 201 });
    }

    // Honour exactly the filters the service sends: id=eq. and or=(...).
    const id = url.searchParams.get("id");
    const or = url.searchParams.get("or");
    let matched = rows;
    if (id?.startsWith("eq.")) matched = rows.filter((row) => row.id === id.slice(3));
    if (or) {
      const wanted = or.replace(/^\(|\)$/g, "").split(",").map((clause) => {
        const [field, value] = clause.split(".eq.");
        return [field, decodeURIComponent(value)];
      });
      matched = rows.filter((row) => wanted.some(([field, value]) => row[field] === value));
    }
    if (method === "DELETE") {
      rows = rows.filter((row) => !matched.includes(row));
      return json(matched);
    }
    return json(matched);
  };

  const call = async (person, { method = "GET", url = "/api/admin/admins", body } = {}) => {
    const response = reply();
    await adminsHandler({ url, method, headers: { cookie: person ? cookieFor(person) : "" }, body }, response);
    return response;
  };

  try {
    await run({ call, state: { get rows() { return rows; }, set fail(value) { failDatabase = value; }, requests } });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("only an admin can read or change the admin list", () =>
  fixture(async ({ call }) => {
    assert.equal((await call(null)).statusCode, 401, "a signed-out visitor");
    const customer = await call(people.customer);
    assert.equal(customer.statusCode, 403);
    assert.match(customer.json.message, /admin huquqi yo‘q/);

    // A customer cannot promote themselves, by any route.
    const grab = await call(people.customer, { method: "POST", body: { phone: "998903333333" } });
    assert.equal(grab.statusCode, 403);
    assert.equal((await call(people.customer, { method: "DELETE", url: "/api/admin/admins?id=email:boss@neosport.uz" })).statusCode, 403);

    assert.equal((await call(people.boss)).statusCode, 200);
  }));

test("the environment's admins are listed but cannot be removed from the panel", () =>
  fixture(async ({ call }) => {
    const listed = (await call(people.boss)).json.admins;
    assert.deepEqual(
      listed.filter((admin) => admin.source === "environment").map((admin) => admin.id).sort(),
      ["email:boss@neosport.uz", "phone:998900000000"],
    );

    for (const id of ["email:boss@neosport.uz", "phone:998900000000"]) {
      const refused = await call(people.boss, { method: "DELETE", url: `/api/admin/admins?id=${encodeURIComponent(id)}` });
      assert.equal(refused.statusCode, 403, id);
      assert.match(refused.json.message, /Server sozlamalaridagi adminni/);
    }

    // Nor can they be duplicated into the table, where they would look removable.
    const duplicate = await call(people.boss, { method: "POST", body: { email: "BOSS@neosport.uz" } });
    assert.equal(duplicate.statusCode, 409);
  }));

test("an admin added in the panel can sign in, and is recognised by either identifier", () =>
  fixture(async ({ call }) => {
    // Before: an ordinary account with no rights anywhere.
    assert.equal(await isStoredAdmin(people.managerEmail), false);
    assert.equal((await call(people.managerEmail)).statusCode, 403);

    const added = await call(people.boss, { method: "POST", body: { email: "Manager@NeoSport.uz ", name: "Manager" } });
    assert.equal(added.statusCode, 201);
    assert.equal(added.json.admin.id, "email:manager@neosport.uz", "the address is normalised");
    assert.equal(added.json.admin.createdBy, "boss@neosport.uz", "who granted it is recorded");

    // After: the same account is an admin everywhere the panel is guarded.
    assert.equal(await isStoredAdmin(people.managerEmail), true);
    assert.equal((await call(people.managerEmail)).statusCode, 200);
    assert.equal((await requireAdmin({ headers: { cookie: cookieFor(people.managerEmail) } })).role, "admin");

    const stats = reply();
    await statsHandler({ url: "/api/admin/stats", method: "GET", headers: { cookie: cookieFor(people.managerEmail) } }, stats);
    assert.notEqual(stats.statusCode, 403, "every guarded endpoint honours the same list");

    // A Telegram admin is matched on the phone instead.
    await call(people.boss, { method: "POST", body: { phone: "+998 90 222 22 22" } });
    assert.equal(await isStoredAdmin(people.managerPhone), true);
    assert.equal(await isStoredAdmin(people.customer), false, "an unrelated customer is still not an admin");
  }));

test("a session is never matched on an identifier it does not have", () =>
  fixture(async ({ call, state }) => {
    // A row for an email-only admin leaves phone empty, and a Telegram session
    // has no email. Comparing the two blanks would make everyone an admin.
    await call(people.boss, { method: "POST", body: { email: "manager@neosport.uz" } });
    assert.equal(state.rows[0].phone, "", "the unused column really is empty");

    assert.equal(await isStoredAdmin({ email: "", phone: "998903333333" }), false);
    assert.equal(await isStoredAdmin({ email: "", phone: "" }), false);
    assert.equal(await isStoredAdmin({}), false);

    // The lookup asks only about the identifiers the session carries.
    state.requests.length = 0;
    await isStoredAdmin({ email: "", phone: "998903333333" });
    assert.equal(state.requests.at(-1).query.includes("email.eq."), false);
  }));

test("an admin cannot remove their own access, and a broken list never silently demotes", () =>
  fixture(async ({ call, state }) => {
    await call(people.boss, { method: "POST", body: { email: "manager@neosport.uz" } });

    const self = await call(people.managerEmail, { method: "DELETE", url: "/api/admin/admins?id=email:manager@neosport.uz" });
    assert.equal(self.statusCode, 409);
    assert.match(self.json.message, /O‘zingizni/);
    assert.equal(await isStoredAdmin(people.managerEmail), true, "the refusal left the access in place");

    // Another admin may still remove them.
    const removed = await call(people.boss, { method: "DELETE", url: "/api/admin/admins?id=email:manager@neosport.uz" });
    assert.equal(removed.statusCode, 200);
    assert.equal(await isStoredAdmin(people.managerEmail), false);
    assert.equal((await call(people.boss, { method: "DELETE", url: "/api/admin/admins?id=email:manager@neosport.uz" })).statusCode, 404);

    // An unreachable list is reported, not answered as "not an admin" — and the
    // environment's admins keep working through it, because they never ask.
    state.fail = true;
    const broken = await call(people.managerPhone);
    assert.equal(broken.statusCode, 503);
    assert.match(broken.json.message, /tekshirib bo‘lmadi/);
    assert.equal((await requireAdmin({ headers: { cookie: cookieFor(people.boss) } })).role, "admin");
  }));

test("an identifier has to be one usable email or one usable phone", () =>
  fixture(async ({ call }) => {
    const rejected = async (body, pattern) => {
      const response = await call(people.boss, { method: "POST", body });
      assert.equal(response.statusCode, 400, JSON.stringify(body));
      assert.match(response.json.message, pattern, JSON.stringify(body));
    };

    await rejected({}, /Email yoki telefon/);
    await rejected({ email: "", phone: "" }, /Email yoki telefon/);
    await rejected({ email: "a@b.uz", phone: "998901234567" }, /Faqat bittasini/);
    await rejected({ email: "not-an-address" }, /Email manzilini/);
    await rejected({ email: "a@b" }, /Email manzilini/);
    await rejected({ phone: "12345" }, /Telefon raqamini/);
    await rejected({ phone: "1998901234567890" }, /Telefon raqamini/);

    // The shapes a session can actually carry are accepted, however written.
    assert.equal((await call(people.boss, { method: "POST", body: { phone: "90 123 45 67" } })).json.admin.id, "phone:998901234567");
    assert.equal(adminKey({ email: "A@B.UZ" }), "email:a@b.uz");
  }));
