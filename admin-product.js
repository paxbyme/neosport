import { initAdmin, apiRequest, isAuthError, escapeHtml, numberFormat, formatMoney, effectivePrice, formSnapshot, confirmDiscard } from "./admin-shell.js";

const productForm = document.querySelector("#product-admin-form");
const productFormTitle = document.querySelector("#product-form-title");
const productFormHint = document.querySelector("#product-form-hint");
const formStatus = document.querySelector("#admin-form-status");
const saveButton = document.querySelector("#save-product-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const colorFields = document.querySelector("#color-fields");
const addColorButton = document.querySelector("#add-color-button");
const sizeChecks = document.querySelector("#size-checks");
const sizeNote = document.querySelector("#size-note");
const imageGallery = document.querySelector("#image-gallery");
const imageCount = document.querySelector("#image-count");
const addImageUrlButton = document.querySelector("#add-image-url");
const imageHint = document.querySelector("#image-hint");
const pricePreview = document.querySelector("#price-preview");
const categorySelect = document.querySelector("#product-category");

const MAX_DISCOUNT_PERCENT = 90;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// Footwear is sold in EU numbers, everything else in letter sizes. The set
// follows the category so a shoe can never be saved as an "XL".
const SIZE_SETS = {
  clothing: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  shoes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
};
// The category list is admin-managed, so these names matter only twice: as the
// options offered while the categories endpoint is unreachable, and as the size
// set for a product whose category was deleted from the list.
const FALLBACK_CATEGORIES = [
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

let categories = [];
let categoriesLoaded = false;
let editingId = null;
let productImages = [];
let imageLoading = false;
let productBaseline = "";
let editorUnavailable = false;
const productSnapshot = () => JSON.stringify([formSnapshot(productForm), productImages]);
const productDirty = () => Boolean(productBaseline && productBaseline !== productSnapshot());
const isWorking = () => imageLoading || (!editorUnavailable && saveButton.disabled);

const findCategory = (name) => {
  const wanted = String(name || "").trim();
  return (
    categories.find((category) => category.name === wanted) ||
    FALLBACK_CATEGORIES.find((category) => category.name === wanted) ||
    null
  );
};
const renderCategoryOptions = () => {
  // Whatever the form is showing survives a re-render: the admin may be in the
  // middle of filling it in, or editing a product with a retired category.
  const chosen = categorySelect.value;
  const offered = categoriesLoaded ? categories.filter((category) => category.active) : FALLBACK_CATEGORIES;

  const group = (label, sizeType) => {
    const items = offered.filter((category) => (category.sizeType || "clothing") === sizeType);
    if (items.length === 0) return "";
    return `<optgroup label="${escapeHtml(label)}">${items
      .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`)
      .join("")}</optgroup>`;
  };

  categorySelect.innerHTML = `<option value="">Tanlang</option>${group("Kiyim", "clothing")}${group("Oyoq kiyim", "shoes")}`;

  if (!chosen) return;
  if (![...categorySelect.options].some((option) => option.value === chosen)) {
    categorySelect.append(new Option(chosen, chosen));
  }
  categorySelect.value = chosen;
};

const loadCategories = async () => {
  try {
    const result = await apiRequest("/api/admin/categories");
    categories = result.categories;
    categoriesLoaded = true;
  } catch (error) {
    if (isAuthError(error)) throw error;
    categories = [];
    categoriesLoaded = false;
  }
  renderCategoryOptions();
};

const isShoeCategory = (category) => findCategory(category)?.sizeType === "shoes";

const renderSizeChecks = (selected = []) => {
  const category = productForm.elements.namedItem("category").value;
  const shoes = isShoeCategory(category);
  const base = shoes ? SIZE_SETS.shoes : SIZE_SETS.clothing;
  // A product edited after its category changed must not silently lose sizes
  // that are no longer in the offered set, so they are kept and stay checked.
  const options = [...new Set([...base, ...selected.map((size) => String(size))])];

  sizeNote.textContent = category
    ? shoes
      ? "oyoq kiyim · 36–45"
      : "kiyim · S–4XL"
    : "kategoriyani tanlang";

  sizeChecks.innerHTML = options
    .map(
      (size) => `
        <label>
          <input type="checkbox" name="sizes" value="${escapeHtml(size)}"${selected.includes(size) ? " checked" : ""} />
          <span>${escapeHtml(size)}</span>
        </label>`,
    )
    .join("");
};

productForm.elements.namedItem("category").addEventListener("change", () => {
  // Keep whatever is still valid when switching between clothing and footwear.
  const checked = [...sizeChecks.querySelectorAll("input:checked")].map((input) => input.value);
  const shoes = isShoeCategory(productForm.elements.namedItem("category").value);
  const stillValid = checked.filter((size) => (shoes ? SIZE_SETS.shoes : SIZE_SETS.clothing).includes(size));
  renderSizeChecks(stillValid);
});

const createColorField = (label = "", hex = "#111111") => {
  const field = document.createElement("div");
  field.className = "color-field";
  field.innerHTML = `
    <input type="text" name="color-label" maxlength="40" placeholder="Rang nomi" aria-label="Rang nomi" required />
    <input type="color" name="color-hex" aria-label="Rangni tanlash" />
    <button type="button" data-remove-color aria-label="Rangni o‘chirish">×</button>`;
  field.querySelector('input[type="text"]').value = label;
  field.querySelector('input[type="color"]').value = hex;
  return field;
};

addColorButton.addEventListener("click", () => {
  if (colorFields.children.length >= 10) return;
  const field = createColorField();
  colorFields.append(field);
  field.querySelector('input[type="text"]').focus();
});

colorFields.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-color]");
  if (!button) return;
  if (colorFields.children.length === 1) {
    button.closest(".color-field").querySelector('input[type="text"]').value = "";
    return;
  }
  button.closest(".color-field").remove();
  addColorButton.focus();
});

const updatePricePreview = () => {
  const price = Number(productForm.elements.namedItem("price").value);
  const discount = Number(productForm.elements.namedItem("discountPercent").value) || 0;

  if (!Number.isFinite(price) || price < 1000 || discount <= 0) {
    pricePreview.hidden = true;
    return;
  }

  const finalPrice = effectivePrice(price, discount);
  pricePreview.hidden = false;
  pricePreview.textContent = `Chegirmali narx: ${formatMoney(finalPrice)} — ${formatMoney(price)} o‘rniga, ${numberFormat.format(price - finalPrice)} so‘m tejaladi.`;
};

productForm.elements.namedItem("price").addEventListener("input", updatePricePreview);
productForm.elements.namedItem("discountPercent").addEventListener("input", updatePricePreview);

const renderImageGallery = () => {
  imageCount.textContent = `${productImages.length}/${MAX_IMAGES}`;
  imageGallery.innerHTML = productImages
    .map(
      (image, index) => `
        <figure class="image-tile${index === 0 ? " is-main" : ""}">
          <img src="${escapeHtml(image)}" alt="" width="720" height="900" />
          <figcaption>${index === 0 ? "Asosiy" : index + 1}</figcaption>
          <div class="image-tile-actions">
            ${index === 0 ? "" : `<button type="button" data-make-main="${index}" aria-label="${index + 1}-rasmni asosiy qilish" title="Asosiy rasm qilish">↑</button>`}
            <button type="button" data-remove-image="${index}" aria-label="${index + 1}-rasmni o‘chirish" title="Rasmni o‘chirish">×</button>
          </div>
        </figure>`,
    )
    .join("");
};

const addImages = (images) => {
  const room = MAX_IMAGES - productImages.length;
  if (room <= 0) {
    formStatus.textContent = `Ko‘pi bilan ${MAX_IMAGES} ta rasm qo‘shish mumkin.`;
    return;
  }
  if (images.length > room) {
    formStatus.textContent = `Faqat ${room} ta rasm qo‘shildi — chegara ${MAX_IMAGES} ta.`;
  }
  productImages.push(...images.slice(0, room));
  renderImageGallery();
};

imageGallery.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-image]");
  const main = event.target.closest("[data-make-main]");

  if (remove) productImages.splice(Number(remove.dataset.removeImage), 1);
  else if (main) {
    // Promoting a photo makes it the one shown on the catalog card.
    const [image] = productImages.splice(Number(main.dataset.makeMain), 1);
    productImages.unshift(image);
  } else return;

  renderImageGallery();
  (imageGallery.querySelector("button") || addImageUrlButton).focus();
});

addImageUrlButton.addEventListener("click", () => {
  const field = productForm.elements.namedItem("image-url");
  const url = String(field.value || "").trim();
  if (!/^https:\/\//i.test(url)) {
    formStatus.textContent = "Rasm havolasi https:// bilan boshlanishi kerak.";
    return;
  }
  formStatus.textContent = "";
  addImages([url]);
  field.value = "";
});

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Rasmni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });

productForm.elements.namedItem("image-file").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length === 0) return;

  const tooBig = files.filter((file) => file.size > MAX_IMAGE_BYTES);
  if (tooBig.length > 0) {
    formStatus.textContent = `Har bir rasm 6 MB dan oshmasligi kerak (${tooBig.length} ta fayl o‘tkazib yuborildi).`;
  } else {
    formStatus.textContent = "";
  }

  const accepted = files.filter((file) => file.size <= MAX_IMAGE_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(file.type));
  const warning = formStatus.textContent;
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) formStatus.textContent = "Faqat JPG, PNG yoki WebP rasmlarni tanlang.";
  imageLoading = true;
  saveButton.disabled = true;
  document.querySelector(".image-fieldset").inert = true;
  imageGallery.setAttribute("aria-busy", "true");
  try {
    const loaded = [];
    for (const [index, file] of accepted.slice(0, MAX_IMAGES - productImages.length).entries()) {
      imageHint.textContent = `Rasm tayyorlanmoqda: ${index + 1}/${Math.min(accepted.length, MAX_IMAGES - productImages.length)}`;
      loaded.push(await fileToDataUrl(file));
    }
    addImages(loaded);
    if (accepted.length > loaded.length) formStatus.textContent = `Ko‘pi bilan ${MAX_IMAGES} ta rasm qo‘shish mumkin.`;
    else if (warning) formStatus.textContent = warning;
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    imageLoading = false;
    saveButton.disabled = false;
    document.querySelector(".image-fieldset").inert = false;
    imageGallery.setAttribute("aria-busy", "false");
    imageHint.textContent = "JPG, PNG yoki WebP · har biri 6 MB gacha · 10 tagacha";
  }
});

const exitEditMode = () => {
  editingId = null;
  productForm.reset();
  colorFields.innerHTML = "";
  colorFields.append(createColorField());
  productImages = [];
  renderImageGallery();
  renderSizeChecks();
  pricePreview.hidden = true;
  formStatus.textContent = "";
  formStatus.classList.remove("is-success");
  productFormTitle.textContent = "YANGI MAHSULOT";
  productFormHint.textContent = "Majburiy maydonlarning barchasini to‘ldiring.";
  imageHint.textContent = "JPG, PNG yoki WebP · 10 tagacha";
  saveButton.querySelector("span").textContent = "Mahsulotni katalogga qo‘shish";
  cancelEditButton.hidden = false;
  productBaseline = productSnapshot();
};

const startEdit = (product) => {
  editingId = product.id;
  document.querySelector("#admin-view-title").textContent = "Mahsulotni tahrirlash";

  productForm.elements.namedItem("name").value = product.name;
  productForm.elements.namedItem("brand").value = product.brand;
  productForm.elements.namedItem("price").value = product.price;
  productForm.elements.namedItem("discountPercent").value = product.discountPercent || 0;
  productForm.elements.namedItem("description").value = product.description;

  // A product saved with a category the select does not offer keeps its own value.
  const categorySelect = productForm.elements.namedItem("category");
  if (![...categorySelect.options].some((option) => option.value === product.category)) {
    categorySelect.append(new Option(product.category, product.category));
  }
  categorySelect.value = product.category;

  // Rendered after the category is set, so a shoe shows 36–45.
  renderSizeChecks(product.sizes);

  colorFields.innerHTML = "";
  for (const color of product.colors) colorFields.append(createColorField(color.label, color.hex));

  productForm.elements.namedItem("image-file").value = "";
  productForm.elements.namedItem("image-url").value = "";
  productImages = [...(product.images || [product.imageUrl].filter(Boolean))];
  renderImageGallery();

  productFormTitle.textContent = "MAHSULOTNI TAHRIRLASH";
  productFormHint.textContent = product.name;
  imageHint.textContent = "Rasmlarga tegmasangiz, joriy galereya saqlanadi";
  saveButton.querySelector("span").textContent = "O‘zgarishlarni saqlash";
  cancelEditButton.hidden = false;
  formStatus.textContent = "";
  formStatus.classList.remove("is-success");

  updatePricePreview();
  productBaseline = productSnapshot();
};

cancelEditButton.addEventListener("click", () => {
  if (isWorking() || (productDirty() && !confirmDiscard())) return;
  exitEditMode();
  formStatus.textContent = "";
  window.location.href = "/admin/products";
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled || imageLoading) return;
  const formData = new FormData(productForm);
  const sizes = formData.getAll("sizes");
  const labels = formData.getAll("color-label");
  const hexes = formData.getAll("color-hex");
  const discountPercent = Number(formData.get("discountPercent")) || 0;

  formStatus.classList.remove("is-success");
  if (sizes.length === 0) {
    formStatus.textContent = "Kamida bitta o‘lchamni tanlang.";
    sizeChecks.querySelector("input")?.focus();
    return;
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > MAX_DISCOUNT_PERCENT) {
    formStatus.textContent = `Chegirma 0 dan ${MAX_DISCOUNT_PERCENT} foizgacha butun son bo‘lishi kerak.`;
    return;
  }
  // A new product needs at least one photo; an edit may keep the stored gallery.
  if (!editingId && productImages.length === 0) {
    formStatus.textContent = "Kamida bitta mahsulot rasmini yuklang.";
    productForm.elements.namedItem("image-file").focus();
    return;
  }

  const isEdit = Boolean(editingId);
  const buttonLabel = saveButton.querySelector("span").textContent;
  saveButton.disabled = true;
  productForm.setAttribute("aria-busy", "true");
  productForm.querySelectorAll("fieldset").forEach(field => { field.inert = true; });
  saveButton.querySelector("span").textContent = "Saqlanmoqda...";
  formStatus.textContent = "";

  try {
    const body = JSON.stringify({
      name: formData.get("name"),
      brand: formData.get("brand"),
      category: formData.get("category"),
      price: Number(formData.get("price")),
      discountPercent,
      description: formData.get("description"),
      sizes,
      colors: labels.map((label, index) => ({ label, hex: hexes[index] })),
      images: productImages,
    });

    await (isEdit
      ? apiRequest(`/api/admin/products?id=${encodeURIComponent(editingId)}`, { method: "PATCH", body })
      : apiRequest("/api/admin/products", { method: "POST", body }));

    exitEditMode();
    history.replaceState(null, "", "/admin/product");
    document.querySelector("#admin-view-title").textContent = "Mahsulot qo‘shish";
    formStatus.textContent = isEdit ? "Mahsulot yangilandi." : "Mahsulot katalogga qo‘shildi.";
    formStatus.classList.add("is-success");
  } catch (error) {
    if (!isAuthError(error)) formStatus.textContent = error.message;
    saveButton.querySelector("span").textContent = buttonLabel;
  } finally {
    saveButton.disabled = false;
    productForm.setAttribute("aria-busy", "false");
    productForm.querySelectorAll("fieldset").forEach(field => { field.inert = false; });
  }
});

initAdmin(async () => {
  editorUnavailable = false;
  productBaseline = "";
  try {
    await loadCategories();
    exitEditMode();
    const params = new URLSearchParams(location.search);
    if (params.has("id")) {
      const result = await apiRequest("/api/admin/products");
      const product = result.products.find(item => item.id === params.get("id"));
      if (!product) throw new Error("Mahsulot topilmadi. Katalogga qaytib, boshqa mahsulotni tanlang.");
      startEdit(product);
    }
  } catch (error) {
    if (isAuthError(error)) return;
    editorUnavailable = true;
    formStatus.textContent = error.message;
  }
  saveButton.disabled = editorUnavailable;
  productForm.querySelectorAll("fieldset").forEach(field => { field.inert = editorUnavailable; });
  productBaseline = productSnapshot();
}, { isDirty: productDirty, isWorking });
