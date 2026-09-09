import { initAdmin, apiRequest, isAuthError, escapeHtml, safeImageUrl, formatMoney, effectivePrice, adminIcon } from "./admin-shell.js";

const productList = document.querySelector("#admin-product-list");
const productCount = document.querySelector("#product-count");
const listStatus = document.querySelector("#product-list-status");
const adminSearch = document.querySelector("#admin-search");
const categoryFilter = document.querySelector("#admin-category-filter");
const statusFilter = document.querySelector("#admin-status-filter");
const resetFilters = document.querySelector("#admin-reset-filters");
const productRetry = document.querySelector("#products-retry");

let products = [];
let productsLoaded = false;

const priceMarkup = (product) => {
  const finalPrice = product.finalPrice ?? effectivePrice(product.price, product.discountPercent);
  if (!product.discountPercent) return escapeHtml(formatMoney(finalPrice));
  return `${escapeHtml(formatMoney(finalPrice))} <s>${escapeHtml(formatMoney(product.price))}</s> <b>−${product.discountPercent}%</b>`;
};

const renderProducts = () => {
  [adminSearch, categoryFilter, statusFilter].forEach(input => { input.disabled = !productsLoaded; });
  if (!productsLoaded) {
    productCount.textContent = "Ma’lumot mavjud emas";
    productList.innerHTML = '<p class="admin-empty">Mahsulotlar yuklanmadi. Qayta urinib ko‘ring.</p>';
    productRetry.hidden = false;
    return;
  }
  const previousCategory = categoryFilter.value;
  categoryFilter.innerHTML = '<option value="">Barchasi</option>' + [...new Set(products.map(product => product.category))].map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  categoryFilter.value = [...categoryFilter.options].some(option => option.value === previousCategory) ? previousCategory : "";
  const query = adminSearch.value.trim().toLocaleLowerCase("uz");
  const filtered = products.filter(product => (!query || `${product.name} ${product.brand}`.toLocaleLowerCase("uz").includes(query)) && (!categoryFilter.value || product.category === categoryFilter.value) && (!statusFilter.value || product.active === (statusFilter.value === "active")));
  productCount.textContent = `${filtered.length} / ${products.length} ta mahsulot`;
  resetFilters.hidden = !(query || categoryFilter.value || statusFilter.value);

  if (products.length === 0) {
    productList.innerHTML = '<div class="admin-empty"><p>Katalog bo‘sh.</p><a href="/admin/product" class="secondary-button" data-new-product>Mahsulot qo‘shish</a></div>';
    return;
  }
  if (!filtered.length) {
    productList.innerHTML = '<p class="admin-empty">Mos mahsulot topilmadi. Qidiruv yoki filtrlarni tozalang.</p>';
    return;
  }

  productList.innerHTML = filtered
    .map(
      (product) => `
        <article class="admin-product${product.active ? "" : " is-inactive"}" data-product-id="${escapeHtml(product.id)}">
          <img src="${escapeHtml(safeImageUrl(product.imageUrl))}" alt="" width="720" height="900" />
          <div class="admin-product-copy">
            <span>${escapeHtml(product.brand)} · ${escapeHtml(product.category)}${product.active ? "" : " · NOFAOL"}</span>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${product.sizes.map(escapeHtml).join(" · ")} · ${product.colors.length} rang · ${(product.images || []).length} rasm</p>
            <strong>${priceMarkup(product)}</strong>
          </div>
          <div class="admin-product-actions">
            <button type="button" data-toggle-product class="status-switch" role="switch" aria-checked="${product.active}" aria-label="${escapeHtml(product.name)}: faol holati">${product.active ? "Faol" : "Nofaol"}</button>
            <a href="/admin/product?id=${encodeURIComponent(product.id)}" data-edit-product class="icon-button" aria-label="${escapeHtml(product.name)}ni tahrirlash" title="Tahrirlash">${adminIcon("pencil")}</a>
            <button type="button" data-delete-product class="delete-product icon-button" aria-label="${escapeHtml(product.name)}ni o‘chirish" title="O‘chirish">${adminIcon("trash-2")}</button>
          </div>
        </article>`,
    )
    .join("");
};

[adminSearch, categoryFilter, statusFilter].forEach(input => input.addEventListener(input === adminSearch ? "input" : "change", renderProducts));
resetFilters.addEventListener("click", () => {
  adminSearch.value = ""; categoryFilter.value = ""; statusFilter.value = ""; renderProducts(); adminSearch.focus();
});
const reloadProducts = async () => {
  try {
    const result = await apiRequest("/api/admin/products");
    products = result.products;
    productsLoaded = true;
    productRetry.hidden = true;
    listStatus.textContent = "";
  } catch (error) {
    if (isAuthError(error)) return;
    products = [];
    productsLoaded = false;
    listStatus.textContent = error.message;
  }
  renderProducts();
};

productRetry.addEventListener("click", async () => {
  productRetry.disabled = true;
  try { await reloadProducts(); }
  finally { productRetry.disabled = false; }
});

productList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-toggle-product], [data-delete-product]");
  const card = button?.closest("[data-product-id]");
  if (!button || !card) return;

  const product = products.find((item) => item.id === card.dataset.productId);
  if (!product) return;
  listStatus.textContent = "";
  listStatus.classList.remove("is-success");

  if ("toggleProduct" in button.dataset) {
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/admin/products?id=${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !product.active }),
      });
      products = products.map((item) => (item.id === result.product.id ? result.product : item));
      renderProducts();
      listStatus.textContent = `${product.name}: ${result.product.active ? "faol" : "nofaol"} qilindi.`;
      listStatus.classList.add("is-success");
      const updated = [...productList.querySelectorAll("[data-product-id]")].find(el => el.dataset.productId === product.id);
      (updated?.querySelector("[data-toggle-product]") || adminSearch).focus();
    } catch (error) {
      if (!isAuthError(error)) listStatus.textContent = error.message;
      button.disabled = false;
    }
    return;
  }

  if (!window.confirm(`“${product.name}” mahsulotini o‘chirasizmi?`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/admin/products?id=${encodeURIComponent(product.id)}`, { method: "DELETE" });
    products = products.filter((item) => item.id !== product.id);
    renderProducts();
    listStatus.textContent = "Mahsulot o‘chirildi.";
    listStatus.classList.add("is-success");
    adminSearch.focus();
  } catch (error) {
    if (!isAuthError(error)) listStatus.textContent = error.message;
    button.disabled = false;
  }
});

initAdmin(reloadProducts);
