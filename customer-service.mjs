import { normalizePhone } from "./auth-session.mjs";
import { listOrders } from "./order-store.mjs";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

// The panel reads the whole list at once and filters in the browser, the way
// the product list already does. A shop this size will not outgrow it soon,
// and the cap keeps one bad query from returning the entire table.
const MAX_CUSTOMERS = 500;
const MAX_ORDERS = 1000;

/**
 * Orders reach a customer two ways. An order placed while signed in carries
 * the user id the users table is keyed by; one placed before that customer
 * ever signed in carries only a phone number. Indexing both keeps a returning
 * customer's history whole, and the two buckets can never claim the same
 * order: one needs a user id, the other needs its absence.
 */
const indexOrders = (orders) => {
  const byUser = new Map();
  const byPhone = new Map();

  for (const order of orders) {
    const userId = order.userId || "";
    const key = userId || normalizePhone(order.customerPhone || order.userPhone);
    if (!key) continue;
    const bucket = userId ? byUser : byPhone;
    bucket.set(key, [...(bucket.get(key) || []), order]);
  }

  return { byUser, byPhone };
};

const latest = (a, b) => (a && (!b || a >= b) ? a : b || null);
const earliest = (a, b) => (a && (!b || a <= b) ? a : b || null);

const summarizeOrders = (orders) => ({
  count: orders.length,
  total: orders.reduce((sum, order) => sum + order.total, 0),
  lastAt: orders.reduce((found, order) => latest(order.createdAt, found), null),
});

const fromUsersTable = async (config, index) => {
  const rows = await supabaseRequest(
    config,
    `/rest/v1/users?select=*&order=created_at.desc&limit=${MAX_CUSTOMERS}`,
    { headers: { Accept: "application/json" } },
  );

  // One number may hold two Telegram accounts, so the phone-only orders are
  // claimed oldest account first instead of being counted against both.
  const claimed = new Set();
  const oldestFirst = [...(rows || [])].reverse().map((row) => {
    const phone = normalizePhone(row.phone);
    const guestOrders = phone && !claimed.has(phone) ? index.byPhone.get(phone) || [] : [];
    if (phone) claimed.add(phone);

    return {
      id: row.id,
      name: row.full_name || "",
      phone,
      chatId: row.telegram_chat_id || "",
      createdAt: row.created_at || null,
      lastLoginAt: row.last_login_at || null,
      orders: summarizeOrders([...(index.byUser.get(row.id) || []), ...guestOrders]),
    };
  });

  return oldestFirst.reverse();
};

/**
 * Without a database there is no users table to read, but the orders on disk
 * still name the people who placed them. Rebuilding the list from those keeps
 * the section honest in local development instead of showing it permanently
 * empty; `source` tells the panel which of the two it is looking at.
 */
const fromOrders = (orders) => {
  const groups = new Map();

  // The phone number is the key rather than the user id, so the orders one
  // person placed before and after signing in stay a single customer. Two
  // Telegram accounts on one number would merge here; only the users table
  // knows they are separate, and this path runs when there isn't one.
  for (const order of orders) {
    const phone = normalizePhone(order.customerPhone || order.userPhone);
    const key = phone || order.userId || "";
    if (!key) continue;

    const entry = groups.get(key) || { id: "", name: "", phone, chatId: "", lastLoginAt: null, createdAt: null, list: [] };
    // listOrders answers newest first, so the name and the account id the
    // customer used most recently are the ones that stick.
    if (!entry.id) entry.id = order.userId || `phone:${phone}`;
    if (!entry.name) entry.name = String(order.customerName || "").trim();
    entry.createdAt = earliest(order.createdAt, entry.createdAt);
    entry.list.push(order);
    groups.set(key, entry);
  }

  return [...groups.values()].map(({ list, ...customer }) => ({ ...customer, orders: summarizeOrders(list) }));
};

/**
 * Every customer the shop knows, newest activity first.
 *
 * Order history is optional in the same way it is for the statistics: a store
 * whose orders table is missing still has customers worth listing, so the
 * failure is logged and reported rather than thrown.
 */
export const listCustomers = async (environment = process.env) => {
  const config = supabaseConfig(environment);
  const orders = await listOrders(environment, { limit: MAX_ORDERS }).catch((error) => {
    console.error("Order history unavailable for customers", error.message);
    return null;
  });

  const customers = config
    ? await fromUsersTable(config, indexOrders(orders || []))
    : fromOrders(orders || []);

  customers.sort((a, b) => {
    const activity = (customer) => latest(customer.orders.lastAt, latest(customer.lastLoginAt, customer.createdAt)) || "";
    return activity(b).localeCompare(activity(a));
  });

  return {
    customers: customers.slice(0, MAX_CUSTOMERS),
    source: config ? "users" : "orders",
    ordersAvailable: orders !== null,
  };
};
