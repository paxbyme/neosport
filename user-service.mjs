import { normalizePhone } from "./auth-session.mjs";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

/** The session subject for a Telegram customer, in one place so the users
 * table and the orders it is joined to can never drift apart. */
export const telegramUserId = (chatId) => `tg:${chatId}`;

const profileOf = ({ chatId, phone, name }) => ({
  phone: normalizePhone(phone),
  full_name: String(name || "").trim().slice(0, 80),
  telegram_chat_id: String(chatId),
  last_login_at: new Date().toISOString(),
});

/**
 * Records the customer behind a verified Telegram contact.
 *
 * Signing up and signing in are the same gesture here — sharing the contact —
 * so the first time a chat does it the row is created and every time after
 * that it is only refreshed. The upsert is what makes the write safe when a
 * customer taps the button twice: two concurrent registrations merge instead
 * of colliding on the primary key.
 *
 * Returns null when no database is configured; the caller treats that as
 * "nothing to record" rather than a failed sign-in.
 */
export const registerTelegramUser = async ({ chatId, phone, name }, environment = process.env) => {
  const config = supabaseConfig(environment);
  if (!config) return null;

  const id = telegramUserId(chatId);
  const known = await supabaseRequest(
    config,
    `/rest/v1/users?select=id&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: { Accept: "application/json" } },
  );

  // created_at is left out on purpose: PostgREST only updates the columns it
  // is given, so a returning customer keeps the date they signed up.
  await supabaseRequest(config, "/rest/v1/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ id, ...profileOf({ chatId, phone, name }) }),
  });

  return { id, isNew: !known?.length };
};

export const findUser = async (id, environment = process.env) => {
  const config = supabaseConfig(environment);
  if (!config) return null;

  const rows = await supabaseRequest(
    config,
    `/rest/v1/users?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: { Accept: "application/json" } },
  );
  const row = rows?.[0];
  return row
    ? {
        id: row.id,
        phone: normalizePhone(row.phone),
        name: row.full_name || "",
        chatId: row.telegram_chat_id || "",
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      }
    : null;
};
