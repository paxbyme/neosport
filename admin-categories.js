import { initAdmin, apiRequest, isAuthError, escapeHtml, adminIcon, formSnapshot, confirmDiscard } from "./admin-shell.js";

const categoryForm = document.querySelector("#category-form");
const categoryList = document.querySelector("#category-list");
const categoryCount = document.querySelector("#category-count");
const categoryStatus = document.querySelector("#category-status");
const saveCategoryButton = document.querySelector("#save-category-button");
const cancelCategoryEditButton = document.querySelector("#cancel-category-edit");
const categoryRetry = document.querySelector("#categories-retry");

const SIZE_TYPE_LABELS = { clothing: "Kiyim · S–4XL", shoes: "Oyoq kiyim · 36–45" };
let products = [];
let productsLoaded = false;
let categories = [];
let categoriesLoaded = false;
let editingCategoryId = null;
let categoryBaseline = "";
const categoryDirty = () => Boolean(categoryBaseline && categoryBaseline !== formSnapshot(categoryForm));
const isWorking = () => saveCategoryButton.disabled;
const categoryUsage = (name) => products.filter((product) => product.category === name).length;

const reloadProducts = async () => {
  try {
    const result = await apiRequest("/api/admin/products");
    products = result.products;
    productsLoaded = true;
  } catch (error) {
    products = [];
    productsLoaded = false;
    if (isAuthError(error)) throw error;
  }
};

const renderCategories = () => {
  categoryCount.textContent = `${categories.length} ta kategoriya`;

  if (categories.length === 0) {
    categoryList.innerHTML = categoriesLoaded
      ? '<p class="admin-empty">Kategoriya yo‘q. Yuqoridagi forma orqali birinchi kategoriyani qo‘shing.</p>'
      : '<p class="admin-empty">Kategoriyalar yuklanmadi.</p>';
    if (!categoriesLoaded) categoryCount.textContent = "Ma’lumot mavjud emas";
  } else {
    categoryList.innerHTML = categories
      .map((category, index) => {
        const used = productsLoaded ? categoryUsage(category.name) : null;
        return `
        <article class="admin-category${category.active ? "" : " is-inactive"}${category.id === editingCategoryId ? " is-editing" : ""}" data-category-id="${escapeHtml(category.id)}">
          <div class="admin-category-order">
            <button type="button" data-move-category="up" aria-label="${escapeHtml(category.name)}ni yuqoriga ko‘chirish"${index === 0 ? " disabled" : ""}>↑</button>
            <button type="button" data-move-category="down" aria-label="${escapeHtml(category.name)}ni pastga ko‘chirish"${index === categories.length - 1 ? " disabled" : ""}>↓</button>
          </div>
          <div class="admin-category-copy">
            <h3>${escapeHtml(category.name)}${category.active ? "" : " · NOFAOL"}</h3>
            <span>${escapeHtml(SIZE_TYPE_LABELS[category.sizeType] || SIZE_TYPE_LABELS.clothing)} · ${used === null ? "Mahsulotlar yuklanmagan" : `${used} ta mahsulot`}</span>
          </div>
          <div class="admin-category-actions">
            <button type="button" data-toggle-category class="status-switch" role="switch" aria-checked="${category.active}" aria-label="${escapeHtml(category.name)}: faol holati">${category.active ? "Faol" : "Nofaol"}</button>
            <button type="button" data-edit-category class="icon-button" aria-label="${escapeHtml(category.name)}ni tahrirlash" title="Tahrirlash">${adminIcon("pencil")}</button>
            <button type="button" data-delete-category class="delete-product icon-button" aria-label="${escapeHtml(category.name)}ni o‘chirish" title="${used === null ? "Avval mahsulotlar yuklanishi kerak" : used > 0 ? "Avval mahsulotlarni boshqa kategoriyaga o‘tkazing" : "O‘chirish"}"${used !== 0 ? " disabled" : ""}>${adminIcon("trash-2")}</button>
          </div>
        </article>`;
      })
      .join("");
  }

};

const loadCategories = async () => {
  try {
    const result = await apiRequest("/api/admin/categories");
    categories = result.categories;
    categoriesLoaded = true;
    categoryRetry.hidden = true;
    categoryStatus.textContent = "";
    categoryStatus.classList.remove("is-success");
  } catch (error) {
    if (isAuthError(error)) return;
    categories = [];
    categoriesLoaded = false;
    categoryRetry.hidden = false;
    categoryStatus.textContent = `Kategoriyalarni yuklab bo‘lmadi: ${error.message}`;
    categoryStatus.classList.remove("is-success");
  }
  renderCategories();
};

categoryRetry.addEventListener("click", async () => {
  categoryRetry.disabled = true;
  try { await reloadProducts(); await loadCategories(); }
  catch (error) { if (!isAuthError(error)) categoryStatus.textContent = error.message; }
  finally { categoryRetry.disabled = false; }
});

const exitCategoryEdit = () => {
  editingCategoryId = null;
  categoryForm.reset();
  saveCategoryButton.querySelector("span").textContent = "Kategoriya qo‘shish";
  cancelCategoryEditButton.hidden = true;
  categoryStatus.textContent = "";
  renderCategories();
  categoryBaseline = formSnapshot(categoryForm);
};

const startCategoryEdit = (category) => {
  if (isWorking() || (categoryDirty() && !confirmDiscard())) return;
  editingCategoryId = category.id;
  categoryForm.elements.namedItem("name").value = category.name;
  categoryForm.elements.namedItem("sizeType").value = category.sizeType;
  saveCategoryButton.querySelector("span").textContent = "O‘zgarishlarni saqlash";
  cancelCategoryEditButton.hidden = false;
  categoryStatus.textContent = "";
  categoryStatus.classList.remove("is-success");
  renderCategories();
  categoryBaseline = formSnapshot(categoryForm);
  categoryForm.elements.namedItem("name").focus();
};

cancelCategoryEditButton.addEventListener("click", () => {
  if (isWorking() || (categoryDirty() && !confirmDiscard())) return;
  exitCategoryEdit();
  categoryForm.elements.namedItem("name").focus();
});

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveCategoryButton.disabled) return;
  const formData = new FormData(categoryForm);
  const body = JSON.stringify({
    name: formData.get("name"),
    sizeType: formData.get("sizeType"),
  });

  const isEdit = Boolean(editingCategoryId);
  const label = saveCategoryButton.querySelector("span").textContent;
  saveCategoryButton.disabled = true;
  categoryForm.querySelectorAll(".field").forEach(field => { field.inert = true; });
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
      // usage counts must follow the new name.
      await reloadProducts();
    } else {
      categories.push(result.category);
    }
    categoriesLoaded = true;

    exitCategoryEdit();
    categoryStatus.textContent = isEdit ? "Kategoriya yangilandi." : "Kategoriya qo‘shildi.";
    categoryStatus.classList.add("is-success");
  } catch (error) {
    if (!isAuthError(error)) categoryStatus.textContent = error.message;
    saveCategoryButton.querySelector("span").textContent = label;
  } finally {
    saveCategoryButton.disabled = false;
    categoryForm.querySelectorAll(".field").forEach(field => { field.inert = false; });
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
  if (isWorking()) return;

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
      if (editingCategoryId === category.id) exitCategoryEdit();
    }
    renderCategories();
    categoryStatus.textContent = "O‘zgarish saqlandi.";
    categoryStatus.classList.add("is-success");
    const selector = button.dataset.moveCategory ? `[data-move-category="${button.dataset.moveCategory}"]` : "[data-toggle-category]";
    const updated = [...categoryList.querySelectorAll("[data-category-id]")].find(el => el.dataset.categoryId === category.id);
    (updated?.querySelector(`${selector}:not(:disabled)`) || categoryForm.elements.namedItem("name")).focus();
  } catch (error) {
    if (!isAuthError(error)) categoryStatus.textContent = error.message;
    button.disabled = false;
  }
});

initAdmin(async () => {
  exitCategoryEdit();
  try { await reloadProducts(); }
  catch (error) { if (isAuthError(error)) return; throw error; }
  await loadCategories();
}, { isDirty: categoryDirty, isWorking });
