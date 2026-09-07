import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const localOrdersFile = join(projectRoot, "data", "orders.json");

// Keeping the local file bounded stops a long-running dev session from growing
// an unreadable JSON blob; production orders live in Supabase.
const LOCAL_ORDER_LIMIT = 500;

const normalizeOrder = (row) => ({
  id: row.id,
  createdAt: row.created_at || row.createdAt,
  customerName: row.customer_name ?? row.customerName ?? "",
  customerPhone: row.customer_phone ?? row.customerPhone ?? "",
  userId: row.user_id ?? row.userId ?? null,
  userEmail: row.user_email ?? row.userEmail ?? null,
  items: Array.isArray(row.items) ? row.items : [],
  total: Number(row.total) || 0,
});

const toDatabaseRow = (order) => ({
  id: order.id,
  created_at: order.createdAt,
  customer_name: order.customerName,
  customer_phone: order.customerPhone,
  user_id: order.userId ?? null,
  user_email: order.userEmail ?? null,
  items: order.items,
  total: order.total,
});

const readLocalOrders = async () => {
  try {
    const orders = JSON.parse(await readFile(localOrdersFile, "utf8"));
    return Array.isArray(orders) ? orders.map(normalizeOrder) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

export const saveOrder = async (order, environment = process.env) => {
  const config = supabaseConfig(environment);

  if (config) {
    await supabaseRequest(config, "/rest/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(toDatabaseRow(order)),
    });
    return;
  }

  if (environment.VERCEL) return;
  const orders = await readLocalOrders();
  orders.unshift(order);
  await mkdir(dirname(localOrdersFile), { recursive: true });
  await writeFile(localOrdersFile, `${JSON.stringify(orders.slice(0, LOCAL_ORDER_LIMIT), null, 2)}\n`, "utf8");
};

export const listOrders = async (environment = process.env, { limit = 500, userId = null } = {}) => {
  const config = supabaseConfig(environment);
  const size = Math.min(1000, Math.max(1, limit));

  if (config) {
    const filter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : "";
    const rows = await supabaseRequest(
      config,
      `/rest/v1/orders?select=*&order=created_at.desc&limit=${size}${filter}`,
      { headers: { Accept: "application/json" } },
    );
    return rows.map(normalizeOrder);
  }

  const orders = await readLocalOrders();
  return (userId ? orders.filter((order) => order.userId === userId) : orders).slice(0, size);
};
