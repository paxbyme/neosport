import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { supabaseConfig, supabaseHeaders, supabaseRequest } from "./supabase.mjs";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const localProductsFile = join(projectRoot, "data", "products.json");
const localUploadsDirectory = join(projectRoot, "assets", "uploads");

export const MAX_DISCOUNT_PERCENT = 90;
export const MAX_IMAGES = 10;

// Discounted prices are rounded to the nearest 1000 so'm: catalog prices in
// Uzbekistan are quoted in thousands, and a 530 100 so'm tag reads as a mistake.
export const effectivePrice = (price, discountPercent) => {
  const percent = Number(discountPercent) || 0;
  if (percent <= 0) return price;
  return Math.max(1000, Math.round((price * (100 - percent)) / 100 / 1000) * 1000);
};

export class ProductError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Supabase failures reach the admin panel as one Uzbek message; the details
// are already in the server log.
const requestSupabase = async (config, path, options) => {
  try {
    return await supabaseRequest(config, path, options);
  } catch (error) {
    throw new ProductError("Mahsulotlar bazasi bilan bog‘lanib bo‘lmadi.", error.status || 502);
  }
};

const normalizeRow = (row) => {
  const price = Number(row.price);
  const discountPercent = Math.min(
    MAX_DISCOUNT_PERCENT,
    Math.max(0, Math.round(Number(row.discount_percent ?? row.discountPercent ?? 0)) || 0),
  );
  const stored = Array.isArray(row.images) ? row.images : [];
  const single = row.image_url || row.imageUrl;
  const images = (stored.length ? stored : single ? [single] : [])
    .map((image) => String(image))
    .filter(Boolean)
    .slice(0, MAX_IMAGES);

  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price,
    discountPercent,
    finalPrice: effectivePrice(price, discountPercent),
    description: row.description || "",
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    colors: Array.isArray(row.colors) ? row.colors : [],
    images,
    // The card, the admin list and every existing consumer read imageUrl, so
    // it stays as a derived alias for the first image.
    imageUrl: images[0] || "",
    active: row.active !== false,
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
};

const toDatabaseRow = (product) => ({
  id: product.id,
  name: product.name,
  brand: product.brand,
  category: product.category,
  price: product.price,
  discount_percent: product.discountPercent,
  description: product.description,
  images: product.images,
  sizes: product.sizes,
  colors: product.colors,
  image_url: product.images?.[0] || product.imageUrl || "",
  active: product.active,
  created_at: product.createdAt,
  updated_at: product.updatedAt,
});

const readLocalProducts = async () => {
  try {
    const products = JSON.parse(await readFile(localProductsFile, "utf8"));
    return Array.isArray(products) ? products.map(normalizeRow) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const toStoredProduct = ({ finalPrice, ...product }) => product;

const writeLocalProducts = async (products) => {
  await mkdir(dirname(localProductsFile), { recursive: true });
  await writeFile(localProductsFile, `${JSON.stringify(products.map(toStoredProduct), null, 2)}\n`, "utf8");
};

export const listProducts = async (environment = process.env, { includeInactive = false } = {}) => {
  const config = supabaseConfig(environment);

  if (config) {
    const activeFilter = includeInactive ? "" : "&active=eq.true";
    const rows = await requestSupabase(
      config,
      `/rest/v1/products?select=*&order=created_at.desc${activeFilter}`,
      { headers: { Accept: "application/json" } },
    );
    return rows.map(normalizeRow);
  }

  const products = await readLocalProducts();
  return includeInactive ? products : products.filter((product) => product.active);
};

const cleanText = (value, label, min, max) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length < min || text.length > max) {
    throw new ProductError(`${label} ${min}–${max} ta belgidan iborat bo‘lishi kerak.`);
  }
  return text;
};

const normalizeImageInput = (value) => {
  const image = String(value || "").trim();
  if (/^https:\/\//i.test(image)) return { type: "url", value: image };

  const match = image.match(/^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new ProductError("JPG, PNG yoki WebP rasm yuklang.");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 6 * 1024 * 1024) {
    throw new ProductError("Har bir rasm 6 MB dan oshmasligi kerak.");
  }
  return { type: "upload", buffer };
};

// The admin panel sends `images`; a single `image` is still accepted so older
// callers keep working. Order matters: the first one is the main photo.
const normalizeImageInputs = (value) => {
  const list = (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  if (list.length > MAX_IMAGES) {
    throw new ProductError(`Ko‘pi bilan ${MAX_IMAGES} ta rasm yuklash mumkin.`);
  }
  return list.map(normalizeImageInput);
};

const normalizeProductFields = (input) => {
  const price = Number(input?.price);
  if (!Number.isInteger(price) || price < 1000 || price > 1_000_000_000) {
    throw new ProductError("Narxni so‘mda to‘g‘ri kiriting.");
  }

  const discountPercent = Number(input?.discountPercent ?? 0);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > MAX_DISCOUNT_PERCENT) {
    throw new ProductError(`Chegirma 0 dan ${MAX_DISCOUNT_PERCENT} foizgacha butun son bo‘lishi kerak.`);
  }

  const sizes = [...new Set(Array.isArray(input?.sizes) ? input.sizes.map((size) => String(size).trim().toUpperCase()) : [])]
    .filter((size) => /^[A-Z0-9]{1,4}$/.test(size))
    .slice(0, 12);
  if (sizes.length === 0) throw new ProductError("Kamida bitta o‘lchamni tanlang.");

  const colors = (Array.isArray(input?.colors) ? input.colors : [])
    .map((color, index) => ({
      id: `color-${index + 1}`,
      label: String(color?.label || "").trim().slice(0, 40),
      hex: String(color?.hex || "").trim().toLowerCase(),
    }))
    .filter((color) => color.label && /^#[0-9a-f]{6}$/.test(color.hex))
    .slice(0, 10);
  if (colors.length === 0) throw new ProductError("Kamida bitta rang nomi va rangini kiriting.");

  return {
    name: cleanText(input?.name, "Mahsulot nomi", 2, 100),
    brand: cleanText(input?.brand, "Brend", 2, 60),
    category: cleanText(input?.category, "Kategoriya", 2, 40),
    price,
    discountPercent,
    description: cleanText(input?.description, "Tavsif", 5, 500),
    sizes,
    colors,
  };
};

const normalizeProductInput = (input) => {
  const images = normalizeImageInputs(input?.images ?? input?.image);
  if (images.length === 0) throw new ProductError("Kamida bitta mahsulot rasmini yuklang.");

  return {
    id: `product-${randomUUID()}`,
    ...normalizeProductFields(input),
    images,
    active: input?.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
};

// Uploads are re-encoded rather than stored as sent: a 3 MB phone photo would
// otherwise be served to every customer at full size. WebP at 1280px wide
// covers the largest place the image is rendered (the 900x1120 modal on a
// 2x screen) and typically lands under 150 KB.
const MAX_IMAGE_WIDTH = 1280;

const optimizeImage = async (buffer) => {
  try {
    // rotate() with no argument applies the EXIF orientation, so portrait
    // photos from a phone do not arrive on their side.
    return await sharp(buffer)
      .rotate()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch (error) {
    console.error("Image could not be processed", error.message);
    throw new ProductError("Rasmni o‘qib bo‘lmadi. Boshqa fayl tanlang.");
  }
};

const uploadImage = async (buffer, filename, environment) => {
  const config = supabaseConfig(environment);

  if (config) {
    const encodedPath = `${encodeURIComponent(config.bucket)}/${encodeURIComponent(filename)}`;
    const response = await fetch(`${config.url}/storage/v1/object/${encodedPath}`, {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "image/webp",
        "Cache-Control": "31536000",
        "x-upsert": "true",
      }),
      body: buffer,
    });
    if (!response.ok) {
      const details = await response.text();
      console.error("Supabase image upload failed", response.status, details.slice(0, 500));
      throw new ProductError("Rasmni yuklab bo‘lmadi.", 502);
    }
    return `${config.url}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${encodeURIComponent(filename)}`;
  }

  if (environment.VERCEL) throw new ProductError("Mahsulotlar bazasi sozlanmagan.", 503);
  await mkdir(localUploadsDirectory, { recursive: true });
  await writeFile(join(localUploadsDirectory, filename), buffer);
  return `/assets/uploads/${filename}`;
};

// Each image gets its own random name, so replacing a gallery never depends on
// positions lining up and never silently overwrites an unrelated photo.
const saveImages = async (images, productId, environment) => {
  const saved = [];
  for (const image of images) {
    if (image.type === "url") {
      saved.push(image.value);
      continue;
    }
    const buffer = await optimizeImage(image.buffer);
    saved.push(await uploadImage(buffer, `${productId}-${randomUUID().slice(0, 8)}.webp`, environment));
  }
  return saved;
};

// Product photos are named after the product, so a deleted or replaced product
// would otherwise leave its image behind in the bucket forever. A storage
// failure is logged but never blocks the database change the user asked for.
const deleteStoredImages = async (imageUrls, environment) => {
  for (const imageUrl of imageUrls || []) await deleteStoredImage(imageUrl, environment);
};

const deleteStoredImage = async (imageUrl, environment) => {
  const image = String(imageUrl || "");
  if (!image) return;

  const config = supabaseConfig(environment);
  if (config) {
    const prefix = `${config.url}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/`;
    // Anything else is an external URL we did not upload and must not touch.
    if (!image.startsWith(prefix)) return;
    try {
      await supabaseRequest(config, `/storage/v1/object/${encodeURIComponent(config.bucket)}/${image.slice(prefix.length)}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Product image could not be removed from storage", error.message);
    }
    return;
  }

  if (!image.startsWith("/assets/uploads/")) return;
  try {
    await rm(join(localUploadsDirectory, image.slice("/assets/uploads/".length)), { force: true });
  } catch (error) {
    console.error("Local product image could not be removed", error.message);
  }
};

export const createProduct = async (input, environment = process.env) => {
  const normalized = normalizeProductInput(input);
  const images = await saveImages(normalized.images, normalized.id, environment);
  const product = { ...normalized, images, imageUrl: images[0] };

  const config = supabaseConfig(environment);
  if (config) {
    const rows = await requestSupabase(config, "/rest/v1/products", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(toDatabaseRow(product)),
    });
    return normalizeRow(rows[0]);
  }

  if (environment.VERCEL) throw new ProductError("Mahsulotlar bazasi sozlanmagan.", 503);
  const products = await readLocalProducts();
  products.unshift(product);
  await writeLocalProducts(products);
  return normalizeRow(product);
};

const toDatabasePatch = (fields, { images, updatedAt }) => {
  const patch = {
    name: fields.name,
    brand: fields.brand,
    category: fields.category,
    price: fields.price,
    discount_percent: fields.discountPercent,
    description: fields.description,
    sizes: fields.sizes,
    colors: fields.colors,
    updated_at: updatedAt,
  };
  // An edit that sends no images keeps the gallery already stored.
  if (images) {
    patch.images = images;
    patch.image_url = images[0] || "";
  }
  return patch;
};

const patchSupabaseProduct = async (config, id, patch) => {
  const rows = await requestSupabase(config, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!rows || rows.length === 0) throw new ProductError("Mahsulot topilmadi.", 404);
  return normalizeRow(rows[0]);
};

const patchLocalProduct = async (id, apply) => {
  const products = await readLocalProducts();
  const index = products.findIndex((product) => product.id === id);
  if (index < 0) throw new ProductError("Mahsulot topilmadi.", 404);

  const updated = apply(products[index]);
  products[index] = updated;
  await writeLocalProducts(products);
  return normalizeRow(updated);
};

export const updateProduct = async (id, input, environment = process.env) => {
  if (!id) throw new ProductError("Mahsulot tanlanmadi.");

  const fields = normalizeProductFields(input);
  const submitted = normalizeImageInputs(input?.images ?? input?.image);
  const updatedAt = new Date().toISOString();
  const config = supabaseConfig(environment);

  // An edit that sends no image at all keeps the gallery untouched; sending a
  // list replaces it, and every photo dropped from it is deleted afterwards.
  const previous = submitted.length ? await getProduct(id, environment) : null;
  if (previous === null && submitted.length) throw new ProductError("Mahsulot topilmadi.", 404);
  const images = submitted.length ? await saveImages(submitted, id, environment) : null;

  const product = config
    ? await patchSupabaseProduct(config, id, toDatabasePatch(fields, { images, updatedAt }))
    : await (async () => {
        if (environment.VERCEL) throw new ProductError("Mahsulotlar bazasi sozlanmagan.", 503);
        return patchLocalProduct(id, (existing) => ({
          ...existing,
          ...fields,
          images: images || existing.images,
          imageUrl: (images || existing.images)?.[0] || existing.imageUrl,
          updatedAt,
        }));
      })();

  if (previous) {
    const kept = new Set(product.images);
    await deleteStoredImages(previous.images.filter((image) => !kept.has(image)), environment);
  }
  return product;
};

export const setProductActive = async (id, active, environment = process.env) => {
  if (!id) throw new ProductError("Mahsulot tanlanmadi.");
  const updatedAt = new Date().toISOString();
  const config = supabaseConfig(environment);

  if (config) {
    return patchSupabaseProduct(config, id, { active: Boolean(active), updated_at: updatedAt });
  }

  if (environment.VERCEL) throw new ProductError("Mahsulotlar bazasi sozlanmagan.", 503);
  return patchLocalProduct(id, (existing) => ({ ...existing, active: Boolean(active), updatedAt }));
};

// One product by id, active or not. The public endpoint hides the inactive
// ones itself; the admin paths below need to see them.
export const getProduct = async (id, environment = process.env) => {
  const config = supabaseConfig(environment);
  if (config) {
    const rows = await requestSupabase(config, `/rest/v1/products?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, {
      headers: { Accept: "application/json" },
    });
    return rows?.[0] ? normalizeRow(rows[0]) : null;
  }
  const products = await readLocalProducts();
  return products.find((product) => product.id === id) || null;
};

export const deleteProduct = async (id, environment = process.env) => {
  if (!id) throw new ProductError("Mahsulot tanlanmadi.");
  const config = supabaseConfig(environment);
  const product = await getProduct(id, environment);

  if (config) {
    await requestSupabase(config, `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await deleteStoredImages(product?.images, environment);
    return;
  }

  if (environment.VERCEL) throw new ProductError("Mahsulotlar bazasi sozlanmagan.", 503);
  const products = await readLocalProducts();
  const nextProducts = products.filter((candidate) => candidate.id !== id);
  if (products.length === nextProducts.length) throw new ProductError("Mahsulot topilmadi.", 404);
  await writeLocalProducts(nextProducts);
  await deleteStoredImages(product?.images, environment);
};

// Categories are stored as text on the product, so the category panel needs a
// way to count what a name is holding and to rewrite it when it is renamed.
export const countProductsInCategory = async (category, environment = process.env) => {
  const name = String(category || "").trim();
  if (!name) return 0;
  const config = supabaseConfig(environment);

  if (config) {
    const rows = await requestSupabase(
      config,
      `/rest/v1/products?select=id&category=eq.${encodeURIComponent(name)}`,
      { headers: { Accept: "application/json" } },
    );
    return rows?.length || 0;
  }

  const products = await readLocalProducts();
  return products.filter((product) => product.category === name).length;
};

export const renameProductCategory = async (from, to, environment = process.env) => {
  const previous = String(from || "").trim();
  const next = String(to || "").trim();
  if (!previous || !next || previous === next) return 0;

  const updatedAt = new Date().toISOString();
  const config = supabaseConfig(environment);

  if (config) {
    const rows = await requestSupabase(
      config,
      `/rest/v1/products?category=eq.${encodeURIComponent(previous)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ category: next, updated_at: updatedAt }),
      },
    );
    return rows?.length || 0;
  }

  const products = await readLocalProducts();
  const renamed = products.filter((product) => product.category === previous);
  if (renamed.length === 0) return 0;

  await writeLocalProducts(
    products.map((product) =>
      product.category === previous ? { ...product, category: next, updatedAt } : product,
    ),
  );
  return renamed.length;
};
