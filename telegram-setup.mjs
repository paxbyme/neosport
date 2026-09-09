// --check reads configuration, schema and webhook status without changing them.
// Without --check this registers the webhook for the explicitly configured site.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
class SetupError extends Error {}

export async function runTelegramSetup({ checkOnly = true, environment = process.env, fetcher = fetch, log = console.log } = {}) {
  const required = {
    TELEGRAM_BOT_TOKEN: value => Boolean(value) && value !== "[SENSITIVE]",
    TELEGRAM_WEBHOOK_SECRET: value => /^[A-Za-z0-9_-]{16,256}$/.test(value || ""),
    SESSION_SECRET: value => String(value || "").length >= 32,
    SUPABASE_URL: value => { try { return new URL(value).protocol === "https:"; } catch { return false; } },
    SUPABASE_SERVICE_ROLE_KEY: value => Boolean(value) && value !== "[SENSITIVE]",
    SITE_URL: value => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; } catch { return false; } },
  };
  const missing = Object.entries(required).filter(([name, validate]) => !validate(environment[name])).map(([name]) => name);
  if (missing.length) {
    log(`Sozlanmagan yoki noto‘g‘ri qiymatlar: ${missing.join(", ")}.`);
    log("Qiymatlarni server muhitiga yoki .env.local fayliga kiriting. Sirlar ekranga chiqarilmaydi.");
    log("SITE_URL aniq HTTPS sayt manzili bo‘lishi kerak; webhook siri 16–256 ta harf, raqam, _ yoki - belgidan iborat bo‘lsin.");
    return false;
  }
  const token = environment.TELEGRAM_BOT_TOKEN;
  const call = async (method, body = {}) => {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new SetupError(`${method}: so‘rov bajarilmadi (HTTP ${response.status}).`);
    return result.result;
  };
  try {
    const me = await call("getMe");
    if (!me?.is_bot || !me.username) throw new SetupError("Telegram tokeni faol botga tegishli emas.");
    log(`Bot: @${me.username}`);
    // limit=0 verifies table/column access without downloading customer data.
    for (const [table, columns] of [
      ["login_tokens", "token,status,chat_id,phone,full_name,next_path,created_at"],
      ["users", "id,phone,full_name,last_login_at"],
    ]) {
      const response = await fetcher(`${environment.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?select=${columns}&limit=0`, {
        headers: { apikey: environment.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new SetupError(`${table}: jadval yoki ustunlar mavjud emas / ruxsat yo‘q (HTTP ${response.status}). supabase-schema.sql faylini tekshiring.`);
      log(`${table}: tayyor`);
    }
    const webhookUrl = `${environment.SITE_URL.replace(/\/$/, "")}/api/telegram/webhook`;
    if (!checkOnly) {
      await call("setWebhook", {
        url: webhookUrl, secret_token: environment.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
      });
      log("Webhook ro‘yxatdan o‘tkazildi. Kutilayotgan xabarlar saqlandi.");
    }
    const info = await call("getWebhookInfo");
    const matches = info.url === webhookUrl;
    log(`Webhook manzili: ${matches ? "SITE_URL bilan mos" : "sozlanmagan yoki SITE_URL bilan mos emas"}`);
    log(`Kutilayotgan yangilanishlar: ${info.pending_update_count}`);
    if (info.last_error_date) log(`Oxirgi webhook xatosi: ${new Date(info.last_error_date * 1000).toISOString()}. Telegram getWebhookInfo orqali tafsilotlarni tekshiring.`);
    if (!matches) log("Domen va server sozlamalarini tekshirgach, npm run telegram:setup buyrug‘ini ishlating.");
    log("Webhook siri Telegram tomonidan qaytarilmaydi. Uni tekshirish uchun saytdan haqiqiy kirish zarur.");
    return matches;
  } catch (error) {
    // Fetch errors may include credential-bearing URLs; print controlled errors only.
    log(error instanceof SetupError
      ? error.message : "Ulanish tekshiruvi bajarilmadi. Tarmoq va server sozlamalarini tekshiring.");
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      if (value !== "[SENSITIVE]") process.env[match[1]] = value;
    }
  }
  if (process.argv.slice(2).some(arg => arg !== "--check")) {
    console.error("Foydalanish: npm run telegram:check yoki npm run telegram:setup");
    process.exitCode = 1;
  } else if (!await runTelegramSetup({ checkOnly: process.argv.includes("--check") })) process.exitCode = 1;
}
