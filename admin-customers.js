import { initAdmin, apiRequest, isAuthError, escapeHtml, numberFormat, formatMoney, formatDateTime } from "./admin-shell.js";

const customerList = document.querySelector("#admin-customer-list");
const customerCount = document.querySelector("#customer-count");
const customerStatus = document.querySelector("#customer-status");
const customerHint = document.querySelector("#customer-hint");
const customerSearch = document.querySelector("#customer-search");
const customerSort = document.querySelector("#customer-sort");
const customerResetFilters = document.querySelector("#customer-reset-filters");
const customerRetry = document.querySelector("#customers-retry");

let customers = [];
let customersLoaded = false;

const formatPhone = (digits) => {
  const value = String(digits || "").replace(/\D/g, "");
  const parts = value.match(/^998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (parts) return `+998 ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4]}`;
  return value ? `+${value}` : "";
};

const customerActivity = (customer) => customer.orders.lastAt || customer.lastLoginAt || customer.createdAt || "";

const CUSTOMER_SORTS = {
  spent: (a, b) => b.orders.total - a.orders.total,
  orders: (a, b) => b.orders.count - a.orders.count,
  new: (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
};

const customerCard = (customer) => {
  const phone = formatPhone(customer.phone);
  const joined = customer.createdAt ? `Ro‘yxatdan o‘tgan: ${formatDateTime(customer.createdAt)}` : "Ro‘yxatdan o‘tgan sanasi noma’lum";
  const seen = customer.lastLoginAt ? ` · Oxirgi kirish: ${formatDateTime(customer.lastLoginAt)}` : "";

  return `
    <article class="admin-customer" data-customer-id="${escapeHtml(customer.id)}">
      <div class="admin-customer-copy">
        <span>${escapeHtml(joined + seen)}</span>
        <h3>${escapeHtml(customer.name || "Ismi ko‘rsatilmagan")}</h3>
        <p>${phone ? `<a href="tel:+${escapeHtml(customer.phone)}">${escapeHtml(phone)}</a>` : "Telefon raqami yo‘q"}</p>
      </div>
      <div class="admin-customer-orders">
        <strong>${customer.orders.count ? `${numberFormat.format(customer.orders.count)} ta buyurtma` : "Buyurtma yo‘q"}</strong>
        <span>${escapeHtml(formatMoney(customer.orders.total))}</span>
        <span>${customer.orders.lastAt ? escapeHtml(`Oxirgisi: ${formatDateTime(customer.orders.lastAt)}`) : "—"}</span>
      </div>
    </article>`;
};

const renderCustomers = () => {
  [customerSearch, customerSort].forEach((input) => { input.disabled = !customersLoaded; });
  if (!customersLoaded) {
    customerCount.textContent = "Ma’lumot mavjud emas";
    customerList.innerHTML = '<p class="admin-empty">Mijozlar yuklanmadi. Qayta urinib ko‘ring.</p>';
    customerRetry.hidden = false;
    return;
  }

  const query = customerSearch.value.trim().toLocaleLowerCase("uz");
  const digits = query.replace(/\D/g, "");
  const filtered = customers.filter((customer) =>
    !query ||
    customer.name.toLocaleLowerCase("uz").includes(query) ||
    (digits && customer.phone.includes(digits)));

  // Every ordering falls back to the most recent activity, so customers who
  // tie on spend or order count still come out in a stable, sensible order.
  const sort = CUSTOMER_SORTS[customerSort.value];
  const sorted = [...filtered].sort((a, b) => (sort ? sort(a, b) : 0) || customerActivity(b).localeCompare(customerActivity(a)));

  customerCount.textContent = `${filtered.length} / ${customers.length} ta mijoz`;
  customerResetFilters.hidden = !(query || customerSort.value !== "recent");

  if (customers.length === 0) {
    customerList.innerHTML = '<p class="admin-empty">Hozircha mijoz yo‘q. Telegram orqali kirgan har bir xaridor shu yerda paydo bo‘ladi.</p>';
    return;
  }
  if (!sorted.length) {
    customerList.innerHTML = '<p class="admin-empty">Mos mijoz topilmadi. Qidiruvni tozalang.</p>';
    return;
  }

  customerList.innerHTML = sorted.map(customerCard).join("");
};

const loadCustomers = async () => {
  try {
    const result = await apiRequest("/api/admin/customers");
    customers = result.customers;
    customersLoaded = true;
    customerRetry.hidden = true;
    customerStatus.textContent = "";

    // The list is worth less if the panel does not admit what is missing from
    // it: a store with no database has only the people who have ordered, and
    // an unreachable orders table leaves every purchase total at zero.
    const hints = [
      result.source === "orders" ? "Ma’lumotlar bazasi ulanmagan — ro‘yxat faqat buyurtmalar asosida tuzildi." : "",
      result.ordersAvailable === false ? "Buyurtma tarixi yuklanmadi, shuning uchun xarid summalari ko‘rsatilmagan." : "",
    ].filter(Boolean);
    customerHint.textContent = hints.join(" ");
    customerHint.hidden = !hints.length;

    renderCustomers();
  } catch (error) {
    if (isAuthError(error)) return;
    customersLoaded = false;
    customerStatus.textContent = error.message;
    renderCustomers();
  }
};

[customerSearch, customerSort].forEach((input) =>
  input.addEventListener(input === customerSearch ? "input" : "change", renderCustomers));

customerResetFilters.addEventListener("click", () => {
  customerSearch.value = "";
  customerSort.value = "recent";
  renderCustomers();
  customerSearch.focus();
});

customerRetry.addEventListener("click", async () => {
  customerRetry.disabled = true;
  customerStatus.textContent = "Yuklanmoqda...";
  try { await loadCustomers(); }
  finally { customerRetry.disabled = false; }
});

initAdmin(loadCustomers);
