import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adminEmails, adminPhones, normalizePhone } from "./auth-session.mjs";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const localAdminsFile = join(projectRoot, "data", "admins.json");

export class AdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Admin rights come from two places that deliberately behave differently.
 *
 * ADMIN_EMAILS and ADMIN_PHONES are the environment's own list. They are the
 * recovery path: they need no database, they are recomputed on every request,
 * and the panel cannot remove them — so losing the database, or an admin
 * removing the wrong row, can never lock everyone out of the shop.
 *
 * The admins table is the list the panel manages. It is checked only after
 * the environment says no, so an ordinary customer request never pays for it.
 */

// One row per admin, keyed by the identifier a session is actually matched on.
export const adminKey = ({ email, phone }) => {
  const address = String(email || "").trim().toLowerCase();
  if (address) return `email:${address}`;
  const digits = normalizePhone(phone);
  return digits ? `phone:${digits}` : "";
};

const normalizeRow = (row) => ({
  id: row.id,
  email: String(row.email || "").toLowerCase(),
  phone: normalizePhone(row.phone),
  name: String(row.name || ""),
  createdAt: row.created_at || row.createdAt || null,
  createdBy: row.created_by ?? row.createdBy ?? "",
  source: "panel",
});

const toDatabaseRow = (admin) => ({
  id: admin.id,
  email: admin.email,
  phone: admin.phone,
  name: admin.name,
  created_at: admin.createdAt,
  created_by: admin.createdBy,
});

const readLocalAdmins = async () => {
  try {
    const admins = JSON.parse(await readFile(localAdminsFile, "utf8"));
    return Array.isArray(admins) ? admins.map(normalizeRow) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const writeLocalAdmins = async (admins) => {
  await mkdir(dirname(localAdminsFile), { recursive: true });
  await writeFile(localAdminsFile, `${JSON.stringify(admins.map(toDatabaseRow), null, 2)}\n`, "utf8");
};

const storedAdmins = async (environment) => {
  const config = supabaseConfig(environment);
  if (config) {
    const rows = await supabaseRequest(config, "/rest/v1/admins?select=*&order=created_at.desc", {
      headers: { Accept: "application/json" },
    });
    return (rows || []).map(normalizeRow);
  }
  return readLocalAdmins();
};

/** The environment's admins, as rows the panel can show but not touch. */
const environmentAdmins = (environment) => [
  ...adminEmails(environment).map((email) => ({ id: `email:${email}`, email, phone: "", name: "", createdAt: null, createdBy: "", source: "environment" })),
  ...adminPhones(environment).map((phone) => ({ id: `phone:${phone}`, email: "", phone, name: "", createdAt: null, createdBy: "", source: "environment" })),
];

/**
 * Whether this session is an admin because the panel says so.
 *
 * Only the identifiers the session actually carries are queried. A Telegram
 * customer has no email, and matching their empty email against a row's empty
 * email column would hand admin rights to everyone — so an absent identifier
 * is left out of the filter entirely rather than compared as "".
 */
export const isStoredAdmin = async (session, environment = process.env) => {
  const email = String(session?.email || "").trim().toLowerCase();
  const phone = normalizePhone(session?.phone);
  if (!email && !phone) return false;

  const config = supabaseConfig(environment);
  if (config) {
    const clauses = [
      ...(email ? [`email.eq.${encodeURIComponent(email)}`] : []),
      ...(phone ? [`phone.eq.${encodeURIComponent(phone)}`] : []),
    ];
    const rows = await supabaseRequest(
      config,
      `/rest/v1/admins?select=id&or=(${clauses.join(",")})&limit=1`,
      { headers: { Accept: "application/json" } },
    );
    return Boolean(rows?.length);
  }

  const admins = await readLocalAdmins();
  return admins.some((admin) => (email && admin.email === email) || (phone && admin.phone === phone));
};

export const listAdmins = async (environment = process.env) => {
  const stored = await storedAdmins(environment);
  const fromEnvironment = environmentAdmins(environment);
  // An identifier listed in both places is shown once, as the environment's:
  // that is the entry that actually cannot be removed here.
  const permanent = new Set(fromEnvironment.map((admin) => admin.id));
  return [...fromEnvironment, ...stored.filter((admin) => !permanent.has(admin.id))];
};

const validateIdentifier = ({ email, phone }) => {
  const address = String(email || "").trim().toLowerCase();
  const digits = normalizePhone(phone);

  if (address && digits) throw new AdminError("Faqat bittasini kiriting: email yoki telefon raqami.");
  if (!address && !digits) throw new AdminError("Email yoki telefon raqamini kiriting.");
  // Google identifies an account by email, Telegram by phone; the value has to
  // be the shape the matching session will actually carry.
  if (address && !/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(address)) throw new AdminError("Email manzilini to‘g‘ri kiriting.");
  if (address && address.length > 120) throw new AdminError("Email manzili juda uzun.");
  if (digits && !/^998\d{9}$/.test(digits)) throw new AdminError("Telefon raqamini +998 90 123 45 67 shaklida kiriting.");

  return { email: address, phone: digits };
};

export const addAdmin = async (input, addedBy = "", environment = process.env) => {
  const { email, phone } = validateIdentifier(input);
  const id = adminKey({ email, phone });
  const name = String(input?.name || "").trim().replace(/\s+/g, " ").slice(0, 80);

  if (environmentAdmins(environment).some((admin) => admin.id === id)) {
    throw new AdminError("Bu hisob allaqachon server sozlamalarida admin.", 409);
  }
  if ((await storedAdmins(environment)).some((admin) => admin.id === id)) {
    throw new AdminError("Bu hisob allaqachon admin.", 409);
  }

  const admin = { id, email, phone, name, createdAt: new Date().toISOString(), createdBy: String(addedBy || "").slice(0, 120) };
  const config = supabaseConfig(environment);

  if (config) {
    await supabaseRequest(config, "/rest/v1/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(toDatabaseRow(admin)),
    });
    return { ...admin, source: "panel" };
  }

  if (environment.VERCEL) throw new AdminError("Adminlar bazasi sozlanmagan.", 503);
  const admins = await readLocalAdmins();
  admins.unshift(admin);
  await writeLocalAdmins(admins);
  return { ...admin, source: "panel" };
};

export const removeAdmin = async (id, removedBy, environment = process.env) => {
  const key = String(id || "").trim();
  if (!key) throw new AdminError("Admin tanlanmadi.");

  // The environment's list is the way back in when the panel is wrong, so it
  // is never editable from inside the panel.
  if (environmentAdmins(environment).some((admin) => admin.id === key)) {
    throw new AdminError("Server sozlamalaridagi adminni bu yerdan o‘chirib bo‘lmaydi.", 403);
  }
  // Removing your own rights would leave you looking at a panel you can no
  // longer load, and only another admin could undo it.
  if (removedBy && adminKey(removedBy) === key) {
    throw new AdminError("O‘zingizni adminlar ro‘yxatidan chiqara olmaysiz.", 409);
  }

  const config = supabaseConfig(environment);
  if (config) {
    const rows = await supabaseRequest(config, `/rest/v1/admins?id=eq.${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!rows?.length) throw new AdminError("Admin topilmadi.", 404);
    return normalizeRow(rows[0]);
  }

  if (environment.VERCEL) throw new AdminError("Adminlar bazasi sozlanmagan.", 503);
  const admins = await readLocalAdmins();
  const removed = admins.find((admin) => admin.id === key);
  if (!removed) throw new AdminError("Admin topilmadi.", 404);
  await writeLocalAdmins(admins.filter((admin) => admin.id !== key));
  return removed;
};
