import assert from "node:assert/strict";
import test from "node:test";
import { runTelegramSetup } from "../telegram-setup.mjs";
const environment = {
  TELEGRAM_BOT_TOKEN:"123:fixture", TELEGRAM_WEBHOOK_SECRET:"fixture-webhook-secret", SESSION_SECRET:"fixture-session-secret-32-characters",
  SITE_URL:"https://neosport.example", SUPABASE_URL:"https://database.invalid", SUPABASE_SERVICE_ROLE_KEY:"fixture-service-key",
};
const fixture = () => {
  const calls = [], logs = [];
  const fetcher = async (input, options = {}) => {
    const url = new URL(input); calls.push({url, ...options});
    if (url.host === "database.invalid") {
      assert.equal(options.method || "GET", "GET");
      assert.equal(url.searchParams.get("limit"), "0", "Do not retrieve customer data");
      return Response.json([]);
    }
    assert.equal(url.host, "api.telegram.org");
    const method = url.pathname.split("/").at(-1);
    assert.ok(["getMe", "getWebhookInfo", "setWebhook"].includes(method), "No messages may be sent");
    return Response.json({ok:true, result:method === "getMe" ? {is_bot:true,username:"FixtureBot"} : method === "getWebhookInfo" ? {url:"https://neosport.example/api/telegram/webhook",pending_update_count:0} : true});
  };
  return {calls, logs, options:{environment, fetcher, log:value=>logs.push(value)}};
};
test("Telegram diagnostics check schema and webhook without writing or retrieving customer data", async () => {
  const f = fixture();
  assert.equal(await runTelegramSetup(f.options), true);
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls.some(c=>c.url.pathname.endsWith("/setWebhook")), false);
  for (const secret of [environment.TELEGRAM_BOT_TOKEN, environment.SESSION_SECRET, environment.TELEGRAM_WEBHOOK_SECRET, environment.SUPABASE_SERVICE_ROLE_KEY]) assert.equal(f.logs.join(" ").includes(secret), false);
});
test("explicit webhook setup preserves pending updates and uses the supplied domain and secret", async () => {
  const f = fixture();
  assert.equal(await runTelegramSetup({...f.options, checkOnly:false}), true);
  const body = JSON.parse(f.calls.find(c=>c.url.pathname.endsWith("/setWebhook")).body);
  assert.equal(body.url,"https://neosport.example/api/telegram/webhook");
  assert.equal(body.secret_token,environment.TELEGRAM_WEBHOOK_SECRET);
  assert.equal(body.drop_pending_updates,undefined);
});
test("setup refuses incomplete configuration before any external request", async () => {
  for (const [name,value] of [["SITE_URL",""],["SITE_URL","http://localhost:4173"],["TELEGRAM_WEBHOOK_SECRET","invalid secret has spaces"],["TELEGRAM_BOT_TOKEN","[SENSITIVE]"],["SESSION_SECRET","short"]]) {
    const f = fixture();
    assert.equal(await runTelegramSetup({...f.options,checkOnly:false,environment:{...environment,[name]:value}}),false);
    assert.equal(f.calls.length,0);
    assert.ok(f.logs[0].includes(name));
  }
});
