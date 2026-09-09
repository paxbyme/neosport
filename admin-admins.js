import { initAdmin, apiRequest, isAuthError, escapeHtml, formatDateTime, adminIcon } from "./admin-shell.js";

const addForm = document.querySelector("#admin-add-form");
const emailInput = document.querySelector("#admin-email");
const phoneInput = document.querySelector("#admin-phone");
const nameInput = document.querySelector("#admin-name");
const addButton = document.querySelector("#add-admin-button");
const formStatus = document.querySelector("#admin-form-status");
const adminList = document.querySelector("#admin-list");
const adminCount = document.querySelector("#admin-count");
const listStatus = document.querySelector("#admin-list-status");
const retry = document.querySelector("#admins-retry");

let admins = [];
let you = "";
let loaded = false;

const formatPhone = (digits) => {
  const value = String(digits || "").replace(/\D/g, "");
  const parts = value.match(/^998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (parts) return `+998 ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4]}`;
  return value ? `+${value}` : "";
};

const identityOf = (admin) => admin.email || formatPhone(admin.phone);

const adminCard = (admin) => {
  const permanent = admin.source === "environment";
  const added = admin.createdAt ? `Qo‘shilgan: ${formatDateTime(admin.createdAt)}` : "Server sozlamalarida";
  // A phone number reads as a number wherever it is shown, including in the
  // note saying who granted the access.
  const by = admin.createdBy ? ` · ${formatPhone(admin.createdBy) || admin.createdBy} tomonidan` : "";
  const isYou = you && identityOf(admin) && (admin.email === you || admin.phone === you);
  // Without a name the identifier is the heading, so repeating it below it
  // would print the same address twice.
  const identity = identityOf(admin);

  return `
    <article class="admin-customer" data-admin-id="${escapeHtml(admin.id)}">
      <div class="admin-customer-copy">
        <span>${escapeHtml(added + by)}</span>
        <h3>${escapeHtml(admin.name || identity)}${isYou ? " <small>(siz)</small>" : ""}</h3>
        ${admin.name ? `<p>${escapeHtml(identity)}</p>` : ""}
      </div>
      <div class="admin-customer-orders">
        <strong>${permanent ? "Doimiy" : "Panel orqali"}</strong>
        ${permanent
          ? '<span>Server sozlamalarida</span>'
          : `<button class="secondary-button" type="button" data-remove-admin="${escapeHtml(admin.id)}"${isYou ? " disabled" : ""}>${adminIcon("x")}Olib tashlash</button>`}
      </div>
    </article>`;
};

const render = () => {
  if (!loaded) {
    adminCount.textContent = "Ma’lumot mavjud emas";
    adminList.innerHTML = '<p class="admin-empty">Adminlar ro‘yxati yuklanmadi. Qayta urinib ko‘ring.</p>';
    retry.hidden = false;
    return;
  }

  adminCount.textContent = `${admins.length} ta admin`;
  adminList.innerHTML = admins.length
    ? admins.map(adminCard).join("")
    : '<p class="admin-empty">Hozircha admin yo‘q.</p>';
};

const load = async () => {
  try {
    const result = await apiRequest("/api/admin/admins");
    admins = result.admins || [];
    you = result.you || "";
    loaded = true;
    retry.hidden = true;
    listStatus.textContent = "";
    render();
  } catch (error) {
    if (isAuthError(error)) return;
    loaded = false;
    listStatus.textContent = error.message;
    render();
  }
};

// Exactly one identifier: the session that will be matched carries an email
// (Google) or a phone (Telegram), never both, so accepting both here would
// only make it unclear which one grants the access.
addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const phone = phoneInput.value.trim();

  if (email && phone) {
    formStatus.textContent = "Faqat bittasini to‘ldiring: email yoki telefon raqami.";
    return emailInput.focus();
  }
  if (!email && !phone) {
    formStatus.textContent = "Email yoki telefon raqamini kiriting.";
    return emailInput.focus();
  }

  addButton.disabled = true;
  formStatus.textContent = "Qo‘shilmoqda...";
  try {
    const result = await apiRequest("/api/admin/admins", {
      method: "POST",
      body: JSON.stringify({ email, phone, name: nameInput.value.trim() }),
    });
    addForm.reset();
    formStatus.textContent = `${identityOf(result.admin)} endi admin.`;
    await load();
  } catch (error) {
    if (!isAuthError(error)) formStatus.textContent = error.message;
  } finally {
    addButton.disabled = false;
  }
});

adminList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-admin]");
  if (!button) return;

  const admin = admins.find((candidate) => candidate.id === button.dataset.removeAdmin);
  if (!admin) return;
  if (!window.confirm(`${identityOf(admin)} admin huquqidan mahrum bo‘ladi. Davom etasizmi?`)) return;

  button.disabled = true;
  listStatus.textContent = "";
  try {
    await apiRequest(`/api/admin/admins?id=${encodeURIComponent(admin.id)}`, { method: "DELETE" });
    await load();
    listStatus.textContent = `${identityOf(admin)} ro‘yxatdan chiqarildi.`;
  } catch (error) {
    button.disabled = false;
    if (!isAuthError(error)) listStatus.textContent = error.message;
  }
});

retry.addEventListener("click", async () => {
  retry.disabled = true;
  listStatus.textContent = "Yuklanmoqda...";
  try { await load(); }
  finally { retry.disabled = false; }
});

[emailInput, phoneInput].forEach((input) =>
  input.addEventListener("input", () => { formStatus.textContent = ""; }));

initAdmin(load);
