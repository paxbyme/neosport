// Registers the bot webhook with Telegram and reports what it sees.
// Usage: npm run telegram:setup
import { existsSync, readFileSync } from "node:fs";

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

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = String(process.env.SITE_URL || "https://neosport-nu.vercel.app").replace(/\/$/, "");

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN topilmadi.");
  console.error("Production sirlari `vercel env pull` orqali olinmaydi — ular [SENSITIVE] bo‘lib keladi.");
  console.error("Yechim: tokenni Development muhitiga ham qo‘shing, keyin `vercel env pull .env.local`.");
  process.exit(1);
}
if (!secret || secret.length < 16) {
  console.error("TELEGRAM_WEBHOOK_SECRET topilmadi yoki juda qisqa (kamida 16 belgi).");
  process.exit(1);
}

const call = async (method, body) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description}`);
  return result.result;
};

const me = await call("getMe");
console.log(`Bot: @${me.username} (${me.first_name})`);

await call("setWebhook", {
  url: `${site}/api/telegram/webhook`,
  secret_token: secret,
  // Only messages matter; skipping the rest keeps the function idle.
  allowed_updates: ["message"],
  drop_pending_updates: true,
});

const info = await call("getWebhookInfo");
console.log(`Webhook: ${info.url}`);
console.log(`Kutilayotgan yangilanishlar: ${info.pending_update_count}`);
if (info.last_error_message) console.log(`Oxirgi xato: ${info.last_error_message}`);
console.log("\nEndi t.me/" + me.username + " ga o‘ting va /start bosib ko‘ring.");
