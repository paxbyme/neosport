import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countProductsInCategory, listProducts, renameProductCategory } from "./product-service.mjs";
import { supabaseConfig, supabaseRequest } from "./supabase.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const localCategoriesFile = join(projectRoot, "data", "categories.json");

// Footwear is sold in EU numbers, everything else in letter sizes. The size
// type belongs to the category, so a new category the admin invents still
// offers the right set of sizes in the product form.
export const SIZE_TYPES = ["clothing", "shoes"];

// What the category select offered before categories became editable. They are
// written to the store the first time the panel is opened, so an existing
// catalog keeps working with exactly the same names.
const DEFAULT_CATEGORIES = [
  { name: "Komplekt", sizeType: "clothing" },
  { name: "Kurtka", sizeType: "clothing" },
  { name: "Hudi", sizeType: "clothing" },
  { name: "Futbolka", sizeType: "clothing" },
  { name: "Shim", sizeType: "clothing" },
  { name: "Shortik", sizeType: "clothing" },
  { name: "Krossovka", sizeType: "shoes" },
  { name: "Botinka", sizeType: "shoes" },
  { name: "Shippak", sizeType: "shoes" },
  { name: "Boshqa", sizeType: "clothing" },
];

const SHOE_HINTS = /krossovka|botinka|shippak|oyoq|sandal|keds/i;

export class CategoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const requestSupabase = async (config, path, options) => {
  try {
    return await supabaseRequest(config, path, options);
  } catch (error) {
    throw new CategoryError("Kategoriyalar bazasi bilan bog‘lanib bo‘lmadi.", error.status || 502);
  }
};

const normalizeRow = (row, index = 0) => ({
  id: row.id,
  name: row.name,
  sizeType: SIZE_TYPES.includes(row.size_type ?? row.sizeType) ? row.size_type ?? row.sizeType : "clothing",
  position: Number.isInteger(row.position) ? row.position : index,
  active: row.active !== false,
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  updatedAt: row.updated_at || row.updatedAt || null,
});

const toDatabaseRow = (category) => ({
  id: category.id,
  name: category.name,
  size_type: category.sizeType,
  position: category.position,
  active: category.active,
  created_at: category.createdAt,
  updated_at: category.updatedAt,
});

const byPosition = (a, b) => a.position - b.position || a.name.localeCompare(b.name, "uz");

const readLocalCategories = async () => {
  try {
    const categories = JSON.parse(await readFile(localCategoriesFile, "utf8"));
    return Array.isArray(categories) ? categories.map(normalizeRow).sort(byPosition) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const writeLocalCategories = async (categories) => {
  await mkdir(dirname(localCategoriesFile), { recursive: true });
  await writeFile(localCategoriesFile, `${JSON.stringify(categories, null, 2)}\n`, "utf8");
};

const readCategories = async (environment) => {
  const config = supabaseConfig(environment);
  if (config) {
    const rows = await requestSupabase(config, "/rest/v1/categories?select=*&order=position.asc", {
      headers: { Accept: "application/json" },
    });
    return rows.map(normalizeRow).sort(byPosition);
  }
  return readLocalCategories();
};

const cleanName = (value) => {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) {
    throw new CategoryError("Kategoriya nomi 2–40 ta belgidan iborat bo‘lishi kerak.");
  }
  return name;
};

const cleanSizeType = (value) => {
  const sizeType = String(value || "clothing").trim();
  if (!SIZE_TYPES.includes(sizeType)) throw new CategoryError("O‘lcham turini tanlang.");
  return sizeType;
};

const sameName = (a, b) => a.toLocaleLowerCase("uz") === b.toLocaleLowerCase("uz");

const insertCategories = async (categories, environment) => {
  const config = supabaseConfig(environment);
  if (config) {
    const rows = await requestSupabase(config, "/rest/v1/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(categories.map(toDatabaseRow)),
    });
    return rows.map(normalizeRow);
  }

  if (environment.VERCEL) throw new CategoryError("Kategoriyalar bazasi sozlanmagan.", 503);
  const stored = await readLocalCategories();
  await writeLocalCategories([...stored, ...categories].sort(byPosition));
  return categories;
};

const buildCategory = (name, sizeType, position) => ({
  id: `category-${randomUUID()}`,
  name,
  sizeType,
  position,
  active: true,
  createdAt: new Date().toISOString(),
  updatedAt: null,
});

/**
 * The very first read seeds the store, so the panel is never empty: the names
 * the select used to hard-code, plus every category already worn by a product
 * in the catalog, which would otherwise become unselectable.
 */
export const ensureCategories = async (environment = process.env) => {
  const stored = await readCategories(environment);
  if (stored.length > 0) return stored;

  const used = new Set();
  try {
    for (const product of await listProducts(environment, { includeInactive: true })) {
      const name = String(product.category || "").trim();
      if (name) used.add(name);
    }
  } catch {
    // A catalog we cannot read is no reason to leave the panel without options.
  }

  const seeds = [...DEFAULT_CATEGORIES];
  for (const name of used) {
    if (seeds.some((seed) => sameName(seed.name, name))) continue;
    seeds.push({ name, sizeType: SHOE_HINTS.test(name) ? "shoes" : "clothing" });
  }

  return insertCategories(
    seeds.map((seed, index) => buildCategory(seed.name, seed.sizeType, index)),
    environment,
  );
};

export const listCategories = async (environment = process.env, { includeInactive = false } = {}) => {
  const categories = await ensureCategories(environment);
  return includeInactive ? categories : categories.filter((category) => category.active);
};

export const createCategory = async (input, environment = process.env) => {
  const name = cleanName(input?.name);
  const sizeType = cleanSizeType(input?.sizeType);
  const categories = await ensureCategories(environment);

  if (categories.some((category) => sameName(category.name, name))) {
    throw new CategoryError("Bu nomdagi kategoriya allaqachon mavjud.", 409);
  }

  const position = categories.reduce((max, category) => Math.max(max, category.position), -1) + 1;
  const [created] = await insertCategories([buildCategory(name, sizeType, position)], environment);
  return created;
};

const patchCategory = async (id, patch, environment) => {
  const config = supabaseConfig(environment);

  if (config) {
    const rows = await requestSupabase(config, `/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!rows || rows.length === 0) throw new CategoryError("Kategoriya topilmadi.", 404);
    return normalizeRow(rows[0]);
  }

  if (environment.VERCEL) throw new CategoryError("Kategoriyalar bazasi sozlanmagan.", 503);
  const categories = await readLocalCategories();
  const index = categories.findIndex((category) => category.id === id);
  if (index < 0) throw new CategoryError("Kategoriya topilmadi.", 404);

  categories[index] = normalizeRow({ ...toDatabaseRow(categories[index]), ...patch }, index);
  await writeLocalCategories(categories.sort(byPosition));
  return categories.find((category) => category.id === id);
};

const findCategory = async (id, environment) => {
  const categories = await ensureCategories(environment);
  const category = categories.find((candidate) => candidate.id === id);
  if (!category) throw new CategoryError("Kategoriya topilmadi.", 404);
  return category;
};

/**
 * Products carry the category as text, so renaming one here has to rewrite
 * every product wearing the old name — otherwise the catalog would keep a
 * label the panel no longer knows about.
 */
export const updateCategory = async (id, input, environment = process.env) => {
  if (!id) throw new CategoryError("Kategoriya tanlanmadi.");
  const name = cleanName(input?.name);
  const sizeType = cleanSizeType(input?.sizeType);

  const categories = await ensureCategories(environment);
  const current = categories.find((candidate) => candidate.id === id);
  if (!current) throw new CategoryError("Kategoriya topilmadi.", 404);
  if (categories.some((category) => category.id !== id && sameName(category.name, name))) {
    throw new CategoryError("Bu nomdagi kategoriya allaqachon mavjud.", 409);
  }

  const updated = await patchCategory(
    id,
    { name, size_type: sizeType, updated_at: new Date().toISOString() },
    environment,
  );

  if (current.name !== name) await renameProductCategory(current.name, name, environment);
  return updated;
};

export const setCategoryActive = async (id, active, environment = process.env) => {
  if (!id) throw new CategoryError("Kategoriya tanlanmadi.");
  return patchCategory(id, { active: Boolean(active), updated_at: new Date().toISOString() }, environment);
};

export const deleteCategory = async (id, environment = process.env) => {
  if (!id) throw new CategoryError("Kategoriya tanlanmadi.");
  const category = await findCategory(id, environment);

  // Deleting a category in use would leave those products with a label no
  // longer offered anywhere, so the admin is asked to move them first.
  const used = await countProductsInCategory(category.name, environment);
  if (used > 0) {
    throw new CategoryError(
      `“${category.name}” kategoriyasida ${used} ta mahsulot bor. Avval ularning kategoriyasini o‘zgartiring yoki kategoriyani nofaol qiling.`,
      409,
    );
  }

  const config = supabaseConfig(environment);
  if (config) {
    await requestSupabase(config, `/rest/v1/categories?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return;
  }

  if (environment.VERCEL) throw new CategoryError("Kategoriyalar bazasi sozlanmagan.", 503);
  const categories = await readLocalCategories();
  await writeLocalCategories(categories.filter((candidate) => candidate.id !== id));
};

/** Moves a category one step up or down in the order the panel and select use. */
export const moveCategory = async (id, direction, environment = process.env) => {
  if (!id) throw new CategoryError("Kategoriya tanlanmadi.");
  const step = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (step === 0) throw new CategoryError("Yo‘nalish noto‘g‘ri.");

  const categories = await ensureCategories(environment);
  const index = categories.findIndex((category) => category.id === id);
  if (index < 0) throw new CategoryError("Kategoriya topilmadi.", 404);

  const target = index + step;
  if (target < 0 || target >= categories.length) return categories;

  // Positions may have drifted (a delete leaves a gap), so the whole list is
  // renumbered from the swapped order rather than trading two values.
  const ordered = [...categories];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

  const updatedAt = new Date().toISOString();
  for (const [position, category] of ordered.entries()) {
    if (category.position === position) continue;
    await patchCategory(category.id, { position, updated_at: updatedAt }, environment);
  }
  return ordered.map((category, position) => ({ ...category, position }));
};
