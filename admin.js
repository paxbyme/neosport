const loginLayer = document.querySelector("#login-layer");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const adminPanel = document.querySelector("#admin-panel");
const logoutButton = document.querySelector("#logout-button");
const productForm = document.querySelector("#product-admin-form");
const productFormTitle = document.querySelector("#product-form-title");
const productFormHint = document.querySelector("#product-form-hint");
const productList = document.querySelector("#admin-product-list");
const productCount = document.querySelector("#product-count");
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
const categoryForm = document.querySelector("#category-form");
const categoryList = document.querySelector("#category-list");
const categoryCount = document.querySelector("#category-count");
const categoryStatus = document.querySelector("#category-status");
const saveCategoryButton = document.querySelector("#save-category-button");
const cancelCategoryEditButton = document.querySelector("#cancel-category-edit");
const categorySelect = document.querySelector("#product-category");
const statsBody = document.querySelector("#stats-body");
const statsRefresh = document.querySelector("#stats-refresh");
const googleSignin = document.querySelector("#google-signin");
const loginPassword = document.querySelector("#login-password");
const telegramSignin = document.querySelector("#telegram-signin");
const loginOr = document.querySelector("#login-or");
const AUTH_STORAGE_KEY = "neosport-admin-session";
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
const SIZE_TYPE_LABELS = { clothing: "Kiyim · S–4XL", shoes: "Oyoq kiyim · 36–45" };

let adminPassword = sessionStorage.getItem(AUTH_STORAGE_KEY) || "";
let products = [];
let categories = [];
let editingId = null;
let editingCategoryId = null;
// Data URLs for newly picked files, https URLs for photos already stored.
let productImages = [];

const numberFormat = new Intl.NumberFormat("uz-UZ");
const formatMoney = (amount) => `${numberFormat.format(amount)} SO‘M`;

// Tile values stay glanceable: a catalog worth 8 430 000 so'm reads as "8.4 mln".
const formatCompactMoney = (amount) => {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)} mln`;
  if (amount >= 1000) return `${Math.round(amount / 1000)} ming`;
  return numberFormat.format(amount);
};

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(date);
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const safeImageUrl = (value) => {
  const url = String(value || "");
  return /^(https:\/\/|\/|assets\/)/i.test(url) ? url : "assets/neosport-mark.webp";
};

// Mirrors effectivePrice in product-service.mjs so the form can preview the
// discounted price without a round trip. The server value always wins.
const effectivePrice = (price, discountPercent) => {
  const percent = Number(discountPercent) || 0;
  if (percent <= 0) return price;
  return Math.max(1000, Math.round((price * (100 - percent)) / 100 / 1000) * 1000);
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      // The session cookie rides along automatically on same-origin requests;
      // the header exists only for the legacy password path.
      ...(adminPassword ? { Authorization: `Bearer ${adminPassword}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || "Server bilan bog‘lanib bo‘lmadi.");
    error.status = response.status;
    throw error;
  }
  return result;
};

/**
 * The bot conversation happens in another tab, so this page waits for the
 * server to report that the token it holds has been verified. The token lives
 * in an HttpOnly cookie, which is why the server answers `waiting` rather than
 * the page checking for itself.
 */
const checkTelegramLogin = async () => {
  try {
    const response = await fetch("/api/auth/telegram/status", { headers: { Accept: "application/json" } });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.ready) {
      window.location.href = result.next || "/admin";
      return false;
    }
    return Boolean(result.waiting);
  } catch {
    return false;
  }
};

let telegramPolling = false;

const waitForTelegram = async () => {
  if (telegramPolling) return;
  telegramPolling = true;
  loginStatus.textContent = "Telegram’da telefon raqamingizni ulashing — bu sahifa o‘zi yangilanadi.";

  // Ten minutes, matching how long the login token stays valid.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    if (!(await checkTelegramLogin())) break;
  }
  telegramPolling = false;
};

telegramSignin?.addEventListener("click", (event) => {
  event.preventDefault();
  // Opened in a new tab so this one stays alive to notice the result.
  window.open(telegramSignin.href, "_blank", "noopener");
  waitForTelegram();
});

const showLogin = (message = "") => {
  adminPanel.hidden = true;
  logoutButton.hidden = true;
  loginLayer.hidden = false;
  loginStatus.textContent = message;
  document.body.classList.add("is-locked");
  loginForm.querySelector("input")?.focus();
};

/* -------------------------------------------------------------- statistics */

const statTile = ({ label, value, sub }) => `
  <div class="stat-tile">
    <span class="stat-label">${escapeHtml(label)}</span>
    <strong class="stat-value">${escapeHtml(value)}</strong>
    <span class="stat-sub">${escapeHtml(sub)}</span>
  </div>`;

const statTable = (title, headers, rows, emptyMessage) => `
  <div class="stat-table">
    <h3>${escapeHtml(title)}</h3>
    ${
      rows.length === 0
        ? `<p class="stat-table-empty">${escapeHtml(emptyMessage)}</p>`
        : `<div class="stat-table-scroll"><table>
      <thead><tr>${headers.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`
    }
  </div>`;

const renderStats = (stats) => {
  const { catalog, orders } = stats;

  const catalogTiles = [
    {
      label: "Jami mahsulot",
      value: numberFormat.format(catalog.total),
      sub: `${catalog.active} faol · ${catalog.inactive} nofaol`,
    },
    {
      label: "Chegirmadagi mahsulot",
      value: numberFormat.format(catalog.discounted),
      sub: catalog.discounted > 0 ? `o‘rtacha ${catalog.averageDiscount}% chegirma` : "chegirma e’lon qilinmagan",
    },
    {
      label: "Katalog qiymati",
      value: formatCompactMoney(catalog.catalogValue),
      sub: catalog.active > 0 ? `o‘rtacha ${formatMoney(catalog.averagePrice)}` : "faol mahsulot yo‘q",
    },
    {
      label: "Brend / kategoriya",
      value: `${catalog.brands.length} / ${catalog.categories.length}`,
      sub: catalog.brands.length ? `eng ko‘pi: ${catalog.brands[0].name} (${catalog.brands[0].count})` : "ma’lumot yo‘q",
    },
  ];

  const orderTiles = orders
    ? [
        { label: "Bugun", value: numberFormat.format(orders.today.count), sub: formatMoney(orders.today.revenue) },
        { label: "So‘nggi 7 kun", value: numberFormat.format(orders.last7Days.count), sub: formatMoney(orders.last7Days.revenue) },
        { label: "So‘nggi 30 kun", value: numberFormat.format(orders.last30Days.count), sub: formatMoney(orders.last30Days.revenue) },
        {
          label: "Jami buyurtma",
          value: numberFormat.format(orders.allTime.count),
          sub: `${numberFormat.format(orders.allTime.items)} dona · ${formatCompactMoney(orders.allTime.revenue)} so‘m`,
        },
      ]
    : [];

  const tables = orders
    ? [
        statTable(
          "Eng ko‘p sotilgan mahsulotlar",
          ["Mahsulot", "Soni", "Summa"],
          orders.topProducts.map((product) => [
            product.brand ? `${product.name} · ${product.brand}` : product.name,
            numberFormat.format(product.quantity),
            formatMoney(product.revenue),
          ]),
          "Hali sotuv bo‘lmadi.",
        ),
        statTable(
          "Oxirgi buyurtmalar",
          ["Raqam", "Sana", "Mijoz", "Telefon", "Soni", "Summa"],
          orders.recent.map((order) => [
            order.id,
            formatDateTime(order.createdAt),
            order.customerName,
            order.customerPhone,
            numberFormat.format(order.itemCount),
            formatMoney(order.total),
          ]),
          "Hali buyurtma qabul qilinmadi.",
        ),
      ]
    : [];

  statsBody.innerHTML = `
    <div class="stats-group">
      <h3 class="stats-group-title">Buyurtmalar</h3>
      ${
        orders
          ? `<div class="stats-grid">${orderTiles.map(statTile).join("")}</div>`
          : '<p class="admin-empty">Buyurtmalar tarixi mavjud emas. Supabase’da <code>orders</code> jadvalini yarating (<code>supabase-schema.sql</code>) — shundan keyin sotuv statistikasi shu yerda ko‘rinadi.</p>'
      }
    </div>
    <div class="stats-group">
      <h3 class="stats-group-title">Katalog</h3>
      <div class="stats-grid">${catalogTiles.map(statTile).join("")}</div>
    </div>
    ${tables.join("")}
    <p class="stats-generated">Yangilandi: ${escapeHtml(formatDateTime(stats.generatedAt))}</p>`;
};

const loadStats = async () => {
  if (!statsBody) return;
  statsRefresh.disabled = true;
  try {
    const result = await apiRequest("/api/admin/stats");
    renderStats(result.stats);
  } catch (error) {
    if (error.status === 401) throw error;
    statsBody.innerHTML = `<p class="admin-empty">Statistikani yuklab bo‘lmadi: ${escapeHtml(error.message)}</p>`;
  } finally {
    statsRefresh.disabled = false;
  }
};

statsRefresh?.addEventListener("click", () => {
  loadStats().catch(() => showLogin("Sessiya tugadi. Qayta kiring."));
});

/* ------------------------------------------------------------- categories */

// A product may still wear a category the admin has since deleted, so the
// fallback keeps its size set right instead of dropping it back to clothing.
const findCategory = (name) => {
  const wanted = String(name || "").trim();
  return (
    categories.find((category) => category.name === wanted) ||
    FALLBACK_CATEGORIES.find((category) => category.name === wanted) ||
    null
  );
};

const categoryUsage = (name) => products.filter((product) => product.category === name).length;

const renderCategoryOptions = () => {
  // Whatever the form is showing survives a re-render: the admin may be in the
  // middle of filling it in, or editing a product with a retired category.
  const chosen = categorySelect.value;
  const offered = categories.length > 0 ? categories.filter((category) => category.active) : FALLBACK_CATEGORIES;

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

const renderCategories = () => {
  categoryCount.textContent = `${categories.length} ta kategoriya`;

  if (categories.length === 0) {
    categoryList.innerHTML =
      '<p class="admin-empty">Kategoriya yo‘q. Yuqoridagi forma orqali birinchi kategoriyani qo‘shing.</p>';
  } else {
    categoryList.innerHTML = categories
      .map((category, index) => {
        const used = categoryUsage(category.name);
        return `
        <article class="admin-category${category.active ? "" : " is-inactive"}${category.id === editingCategoryId ? " is-editing" : ""}" data-category-id="${escapeHtml(category.id)}">
          <div class="admin-category-order">
            <button type="button" data-move-category="up" aria-label="${escapeHtml(category.name)}ni yuqoriga ko‘chirish"${index === 0 ? " disabled" : ""}>↑</button>
            <button type="button" data-move-category="down" aria-label="${escapeHtml(category.name)}ni pastga ko‘chirish"${index === categories.length - 1 ? " disabled" : ""}>↓</button>
          </div>
          <div class="admin-category-copy">
            <h3>${escapeHtml(category.name)}${category.active ? "" : " · NOFAOL"}</h3>
            <span>${escapeHtml(SIZE_TYPE_LABELS[category.sizeType] || SIZE_TYPE_LABELS.clothing)} · ${used} ta mahsulot</span>
          </div>
          <div class="admin-category-actions">
            <button type="button" data-edit-category>Tahrirlash</button>
            <button type="button" data-toggle-category>${category.active ? "Nofaol qilish" : "Faol qilish"}</button>
            <button type="button" data-delete-category class="delete-product"${used > 0 ? " disabled title=\"Avval mahsulotlarni boshqa kategoriyaga o‘tkazing\"" : ""}>O‘chirish</button>
          </div>
        </article>`;
      })
      .join("");
  }

  renderCategoryOptions();
};

const loadCategories = async () => {
  try {
    const result = await apiRequest("/api/admin/categories");
    categories = result.categories;
    categoryStatus.textContent = "";
    categoryStatus.classList.remove("is-success");
  } catch (error) {
    if (error.status === 401) throw error;
    // The product form still has to work, so it falls back to the built-in list.
    categories = [];
    categoryStatus.textContent = `Kategoriyalarni yuklab bo‘lmadi: ${error.message}`;
    categoryStatus.classList.remove("is-success");
  }
  renderCategories();
};

const exitCategoryEdit = () => {
  editingCategoryId = null;
  categoryForm.reset();
  saveCategoryButton.querySelector("span").textContent = "Kategoriya qo‘shish";
  cancelCategoryEditButton.hidden = true;
  renderCategories();
};

const startCategoryEdit = (category) => {
  editingCategoryId = category.id;
  categoryForm.elements.namedItem("name").value = category.name;
  categoryForm.elements.namedItem("sizeType").value = category.sizeType;
  saveCategoryButton.querySelector("span").textContent = "O‘zgarishlarni saqlash";
  cancelCategoryEditButton.hidden = false;
  categoryStatus.textContent = "";
  categoryStatus.classList.remove("is-success");
  renderCategories();
  categoryForm.elements.namedItem("name").focus();
};

cancelCategoryEditButton.addEventListener("click", exitCategoryEdit);

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(categoryForm);
  const body = JSON.stringify({
    name: formData.get("name"),
    sizeType: formData.get("sizeType"),
  });

  const isEdit = Boolean(editingCategoryId);
  const label = saveCategoryButton.querySelector("span").textContent;
  saveCategoryButton.disabled = true;
  saveCategoryButton.querySelector("span").textContent = "Saqlanmoqda...";
  categoryStatus.textContent = "";
  categoryStatus.classList.remove("is-success");

  try {
    const result = isEdit
      ? await apiRequest(`/api/admin/categories?id=${encodeURIComponent(editingCategoryId)}`, { method: "PATCH", body })
      : await apiRequest("/api/admin/categories", { method: "POST", body });

    if (isEdit) {
      categories = categories.map((category) => (category.id === result.category.id ? result.category : category));
      // Renaming rewrites the category on every product wearing it, so the
      // catalog list below is reloaded rather than left showing the old name.
      await reloadProducts();
    } else {
      categories.push(result.category);
    }

    exitCategoryEdit();
    categoryStatus.textContent = isEdit ? "Kategoriya yangilandi." : "Kategoriya qo‘shildi.";
    categoryStatus.classList.add("is-success");
  } catch (error) {
    if (error.status === 401) showLogin("Sessiya tugadi. Qayta kiring.");
    else categoryStatus.textContent = error.message;
    saveCategoryButton.querySelector("span").textContent = label;
  } finally {
    saveCategoryButton.disabled = false;
  }
});

categoryList.addEventListener("click", async (event) => {
  const button = event.target.closest(
    "[data-move-category], [data-edit-category], [data-toggle-category], [data-delete-category]",
  );
  const card = button?.closest("[data-category-id]");
  if (!button || !card) return;

  const category = categories.find((item) => item.id === card.dataset.categoryId);
  if (!category) return;

  if ("editCategory" in button.dataset) {
    startCategoryEdit(category);
    return;
  }

  categoryStatus.textContent = "";
  categoryStatus.classList.remove("is-success");
  button.disabled = true;

  try {
    if (button.dataset.moveCategory) {
      const result = await apiRequest(`/api/admin/categories?id=${encodeURIComponent(category.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ move: button.dataset.moveCategory }),
      });
      categories = result.categories;
    } else if ("toggleCategory" in button.dataset) {
      const result = await apiRequest(`/api/admin/categories?id=${encodeURIComponent(category.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !category.active }),
      });
      categories = categories.map((item) => (item.id === result.category.id ? result.category : item));
    } else {
      if (!window.confirm(`“${category.name}” kategoriyasini o‘chirasizmi?`)) {
        button.disabled = false;
        return;
      }
      await apiRequest(`/api/admin/categories?id=${encodeURIComponent(category.id)}`, { method: "DELETE" });
      categories = categories.filter((item) => item.id !== category.id);
      if (editingCategoryId === category.id) editingCategoryId = null;
    }
    renderCategories();
  } catch (error) {
    if (error.status === 401) showLogin("Sessiya tugadi. Qayta kiring.");
    else categoryStatus.textContent = error.message;
    button.disabled = false;
  }
});

/* ------------------------------------------------------------ product list */

const priceMarkup = (product) => {
  const finalPrice = product.finalPrice ?? effectivePrice(product.price, product.discountPercent);
  if (!product.discountPercent) return escapeHtml(formatMoney(finalPrice));
  return `${escapeHtml(formatMoney(finalPrice))} <s>${escapeHtml(formatMoney(product.price))}</s> <b>−${product.discountPercent}%</b>`;
};

const renderProducts = () => {
  productCount.textContent = `${products.length} ta mahsulot`;
  // The category cards show how many products each one holds.
  renderCategories();

  if (products.length === 0) {
    productList.innerHTML = '<p class="admin-empty">Katalog bo‘sh. Yuqoridagi forma orqali birinchi mahsulotni qo‘shing.</p>';
    return;
  }

  productList.innerHTML = products
    .map(
      (product) => `
        <article class="admin-product${product.active ? "" : " is-inactive"}${product.id === editingId ? " is-editing" : ""}" data-product-id="${escapeHtml(product.id)}">
          <img src="${escapeHtml(safeImageUrl(product.imageUrl))}" alt="" width="720" height="900" />
          <div class="admin-product-copy">
            <span>${escapeHtml(product.brand)} · ${escapeHtml(product.category)}${product.active ? "" : " · NOFAOL"}</span>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${product.sizes.map(escapeHtml).join(" · ")} · ${product.colors.length} rang · ${(product.images || []).length} rasm</p>
            <strong>${priceMarkup(product)}</strong>
          </div>
          <div class="admin-product-actions">
            <button type="button" data-edit-product aria-label="${escapeHtml(product.name)}ni tahrirlash">Tahrirlash</button>
            <button type="button" data-toggle-product aria-label="${escapeHtml(product.name)}ni ${product.active ? "nofaol" : "faol"} qilish">${product.active ? "Nofaol qilish" : "Faol qilish"}</button>
            <button type="button" data-delete-product class="delete-product" aria-label="${escapeHtml(product.name)}ni o‘chirish">O‘chirish</button>
          </div>
        </article>`,
    )
    .join("");
};

/* ----------------------------------------------------------------- session */

const reloadProducts = async () => {
  const result = await apiRequest("/api/admin/products");
  products = result.products;
  renderProducts();
};

const showAdmin = async () => {
  await reloadProducts();
  loginLayer.hidden = true;
  adminPanel.hidden = false;
  logoutButton.hidden = false;
  document.body.classList.remove("is-locked");
  // Categories decide what the product form offers, so they load before the
  // (slower, optional) statistics.
  await loadCategories();
  await loadStats();
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminPassword = String(new FormData(loginForm).get("password") || "");
  loginStatus.textContent = "Tekshirilmoqda...";
  try {
    await showAdmin();
    sessionStorage.setItem(AUTH_STORAGE_KEY, adminPassword);
    loginForm.reset();
  } catch (error) {
    adminPassword = "";
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    showLogin(error.message);
  }
});

logoutButton.addEventListener("click", () => {
  adminPassword = "";
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  // Clearing the HttpOnly cookie is the server's job, so signing out is a trip
  // through the logout endpoint for both paths.
  window.location.href = "/api/auth/logout?next=/admin";
});

/* -------------------------------------------------------------------- form */

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
    <input type="text" name="color-label" maxlength="40" placeholder="Rang nomi" required />
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
            ${index === 0 ? "" : `<button type="button" data-make-main="${index}" aria-label="${index + 1}-rasmni asosiy qilish">↑</button>`}
            <button type="button" data-remove-image="${index}" aria-label="${index + 1}-rasmni o‘chirish">×</button>
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

  const accepted = files.filter((file) => file.size <= MAX_IMAGE_BYTES);
  addImages(await Promise.all(accepted.map(fileToDataUrl)));
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
  productFormTitle.textContent = "YANGI MAHSULOT";
  productFormHint.textContent = "Majburiy maydonlarning barchasini to‘ldiring.";
  imageHint.textContent = "JPG, PNG yoki WebP · 10 tagacha";
  saveButton.querySelector("span").textContent = "Mahsulotni katalogga qo‘shish";
  cancelEditButton.hidden = true;
  renderProducts();
};

const startEdit = (product) => {
  editingId = product.id;

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
  renderProducts();
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
  productForm.elements.namedItem("name").focus();
};

cancelEditButton.addEventListener("click", exitEditMode);

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(productForm);
  const sizes = formData.getAll("sizes");
  const labels = formData.getAll("color-label");
  const hexes = formData.getAll("color-hex");
  const discountPercent = Number(formData.get("discountPercent")) || 0;

  formStatus.classList.remove("is-success");
  if (sizes.length === 0) {
    formStatus.textContent = "Kamida bitta o‘lchamni tanlang.";
    return;
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > MAX_DISCOUNT_PERCENT) {
    formStatus.textContent = `Chegirma 0 dan ${MAX_DISCOUNT_PERCENT} foizgacha butun son bo‘lishi kerak.`;
    return;
  }
  // A new product needs at least one photo; an edit may keep the stored gallery.
  if (!editingId && productImages.length === 0) {
    formStatus.textContent = "Kamida bitta mahsulot rasmini yuklang.";
    return;
  }

  const isEdit = Boolean(editingId);
  const buttonLabel = saveButton.querySelector("span").textContent;
  saveButton.disabled = true;
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

    const result = isEdit
      ? await apiRequest(`/api/admin/products?id=${encodeURIComponent(editingId)}`, { method: "PATCH", body })
      : await apiRequest("/api/admin/products", { method: "POST", body });

    if (isEdit) products = products.map((product) => (product.id === result.product.id ? result.product : product));
    else products.unshift(result.product);

    exitEditMode();
    formStatus.textContent = isEdit ? "Mahsulot yangilandi." : "Mahsulot katalogga qo‘shildi.";
    formStatus.classList.add("is-success");
    loadStats().catch(() => {});
  } catch (error) {
    if (error.status === 401) showLogin("Sessiya tugadi. Qayta kiring.");
    else formStatus.textContent = error.message;
    saveButton.querySelector("span").textContent = buttonLabel;
  } finally {
    saveButton.disabled = false;
  }
});

/* ------------------------------------------------------------ list actions */

productList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-product], [data-toggle-product], [data-delete-product]");
  const card = button?.closest("[data-product-id]");
  if (!button || !card) return;

  const product = products.find((item) => item.id === card.dataset.productId);
  if (!product) return;

  if ("editProduct" in button.dataset) {
    startEdit(product);
    return;
  }

  if ("toggleProduct" in button.dataset) {
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/admin/products?id=${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !product.active }),
      });
      products = products.map((item) => (item.id === result.product.id ? result.product : item));
      renderProducts();
      loadStats().catch(() => {});
    } catch (error) {
      if (error.status === 401) showLogin("Sessiya tugadi. Qayta kiring.");
      else formStatus.textContent = error.message;
      button.disabled = false;
    }
    return;
  }

  if (!window.confirm(`“${product.name}” mahsulotini o‘chirasizmi?`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/admin/products?id=${encodeURIComponent(product.id)}`, { method: "DELETE" });
    products = products.filter((item) => item.id !== product.id);
    if (editingId === product.id) exitEditMode();
    else renderProducts();
    loadStats().catch(() => {});
  } catch (error) {
    if (error.status === 401) showLogin("Sessiya tugadi. Qayta kiring.");
    else formStatus.textContent = error.message;
    button.disabled = false;
  }
});

const start = async () => {
  let auth = { user: null, googleEnabled: false };
  try {
    const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    if (response.ok) auth = await response.json();
  } catch {
    // Offline or the endpoint is missing: the password form is still a way in.
  }

  googleSignin.hidden = !auth.googleEnabled;
  telegramSignin.hidden = !auth.telegramEnabled;
  loginOr.hidden = !(auth.googleEnabled && auth.telegramEnabled);
  // The password form is offered only while no social sign-in is available.
  loginPassword.hidden = auth.googleEnabled || auth.telegramEnabled;

  if (auth.user?.role === "admin") {
    return showAdmin().catch((error) => showLogin(error.message));
  }

  if (auth.user) {
    const who = auth.user.email || auth.user.phone || "Bu hisob";
    return showLogin(`${who} — bu hisobda admin huquqi yo‘q.`);
  }

  // Returning to this tab after talking to the bot: pick the flow back up.
  if (await checkTelegramLogin()) {
    showLogin();
    return waitForTelegram();
  }

  if (adminPassword) {
    return showAdmin().catch(() => {
      adminPassword = "";
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      showLogin("Qayta kiring.");
    });
  }

  return showLogin();
};

start();
