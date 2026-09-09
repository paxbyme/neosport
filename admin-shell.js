// Shared chrome, authentication and browser helpers. Task data stays in page modules.
const routes = {
  stats: "/admin",
  categories: "/admin/categories",
  products: "/admin/products",
  editor: "/admin/product",
  customers: "/admin/customers",
  admins: "/admin/admins",
};
const page = document.body.dataset.adminPage;
document.querySelector(".admin-header").innerHTML = `<button class="admin-menu-toggle icon-button" id="admin-menu-toggle" type="button" aria-label="Menyuni ochish" aria-controls="admin-nav" aria-expanded="false" hidden><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#menu" /></svg></button>
      <a class="admin-brand" href="/" aria-label="NeoSport bosh sahifasi">
        <picture>
          <source srcset="/assets/neosport-mark.webp" type="image/webp" />
          <img src="/assets/neosport-mark.png" alt="" width="480" height="540" />
        </picture>
        <span>NEO<b>SPORT</b></span>
      </a>
      <div>
        <span class="admin-label">BOSHQARUV</span>
        <button id="logout-button" type="button" hidden>Chiqish</button>
      </div>`;
document.querySelector("#admin-shell").insertAdjacentHTML("afterbegin", `<button class="admin-nav-backdrop" id="admin-nav-backdrop" type="button" aria-label="Menyuni yopish" tabindex="-1" hidden></button>
      <aside class="admin-nav" id="admin-nav" aria-label="Boshqaruv menyusi">
        <div class="admin-nav-head"><strong>Menyu</strong><button class="icon-button" id="admin-menu-close" type="button" aria-label="Menyuni yopish" title="Yopish"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#x" /></svg></button></div>
        <p class="nav-label">ISH MAYDONI</p>
        <nav aria-label="Boshqaruv bo‘limlari">
          <a href="/admin" data-view="stats"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#chart-no-axes-column" /></svg>Statistika</a>
          <a href="/admin/categories" data-view="categories"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#layout-grid" /></svg>Kategoriyalar</a>
          <a href="/admin/products" data-view="products"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#shopping-bag" /></svg>Mahsulotlar</a>
          <a href="/admin/customers" data-view="customers"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#users" /></svg>Mijozlar</a>
          <a href="/admin/admins" data-view="admins"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#shield" /></svg>Adminlar</a>
          <a href="/admin/product" data-view="editor"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#plus" /></svg>Mahsulot qo‘shish</a>
        </nav>
        <div class="admin-nav-bottom"><a href="/shop"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#arrow-up-right" /></svg>Onlayn do‘kon</a><p>NEOSPORT · NAMANGAN</p></div>
      </aside>`);
document.querySelector(`[data-view="${page}"]`)?.setAttribute("aria-current", "page");

const loginLayer = document.querySelector("#login-layer");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const adminPanel = document.querySelector("#admin-panel");
const logoutButton = document.querySelector("#logout-button");
const googleSignin = document.querySelector("#google-signin");
const loginPassword = document.querySelector("#login-password");
const telegramSignin = document.querySelector("#telegram-signin");
const loginOr = document.querySelector("#login-or");
const adminShell = document.querySelector("#admin-shell");
const adminNav = document.querySelector("#admin-nav");
const menuToggle = document.querySelector("#admin-menu-toggle");
const menuBackdrop = document.querySelector("#admin-nav-backdrop");

export const AUTH_STORAGE_KEY = "neosport-admin-session";
let adminPassword = sessionStorage.getItem(AUTH_STORAGE_KEY) || "";
let authenticated = false;
let authRejected = false;
let loadPage;
let signingIn = false;
let guards = {};
let leaving = false;
export const formSnapshot = (form) => JSON.stringify([...new FormData(form)].filter(([name]) => name !== "image-file"));
export const confirmDiscard = () => window.confirm("Saqlanmagan o‘zgarishlar bekor qilinadi. Davom etasizmi?");
export const adminIcon = (name) => `<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#${name}" /></svg>`;

const setAdminMenu = (open, restore = true) => {
  adminNav.classList.toggle("is-open", open);
  document.body.classList.toggle("nav-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuBackdrop.hidden = !open;
  document.querySelector(".admin-header").inert = open;
  document.querySelector(".admin-main").inert = open;
  document.querySelector(".skip-link").inert = open;
  if (open) {
    adminNav.setAttribute("role", "dialog");
    adminNav.setAttribute("aria-modal", "true");
    document.querySelector("#admin-menu-close").focus();
  } else {
    adminNav.removeAttribute("role");
    adminNav.removeAttribute("aria-modal");
    if (restore) menuToggle.focus();
  }
};
menuToggle.addEventListener("click", () => setAdminMenu(true));
menuBackdrop.addEventListener("click", () => setAdminMenu(false));
document.querySelector("#admin-menu-close").addEventListener("click", () => setAdminMenu(false));
window.addEventListener("resize", () => {
  if (innerWidth >= 768 && adminNav.classList.contains("is-open")) setAdminMenu(false, false);
});
document.addEventListener("keydown", (event) => {
  // The native Telegram dialog owns focus while it is in the top layer.
  if (document.querySelector("#telegram-auth-dialog")?.open) return;
  const surface = !loginLayer.hidden ? loginForm : adminNav.classList.contains("is-open") ? adminNav : null;
  if (!surface) return;
  if (event.key === "Escape" && surface === adminNav) setAdminMenu(false);
  if (event.key !== "Tab") return;
  const items = [...surface.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(el => el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
});
window.addEventListener("beforeunload", (event) => {
  if (leaving || (!guards.isDirty?.() && !guards.isWorking?.())) return;
  event.preventDefault();
  event.returnValue = "";
});

export const numberFormat = new Intl.NumberFormat("uz-UZ");
export const formatMoney = (amount) => `${numberFormat.format(amount)} so‘m`;

// Tile values stay glanceable: a catalog worth 8 430 000 so'm reads as "8.4 mln".
export const formatCompactMoney = (amount) => {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)} mln`;
  if (amount >= 1000) return `${Math.round(amount / 1000)} ming`;
  return numberFormat.format(amount);
};

export const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(date);
};

export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const safeImageUrl = (value) => {
  const url = String(value || "");
  return /^(https:\/\/|\/|assets\/)/i.test(url) ? (url.startsWith("assets/") ? `/${url}` : url) : "/assets/neosport-mark.webp";
};

// Mirrors effectivePrice in product-service.mjs so the form can preview the
// discounted price without a round trip. The server value always wins.
export const effectivePrice = (price, discountPercent) => {
  const percent = Number(discountPercent) || 0;
  if (percent <= 0) return price;
  return Math.max(1000, Math.round((price * (100 - percent)) / 100 / 1000) * 1000);
};
export const isAuthError = (error) => error.status === 401 || error.status === 403;

export const apiRequest = async (path, options = {}) => {
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
    if (isAuthError(error)) {
      authRejected = true;
      authenticated = false;
      adminPassword = "";
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      showLogin(error.status === 401 ? "Sessiya tugadi. Qayta kiring." : error.message);
    }
    throw error;
  }
  // A legacy password is verified by the page's required management request.
  if (!authRejected) authenticated = true;
  return result;
};

const showLogin = (message = "") => {
  setAdminMenu(false, false);
  adminShell.hidden = true;
  menuToggle.hidden = true;
  adminPanel.hidden = true;
  logoutButton.hidden = true;
  loginLayer.hidden = false;
  loginStatus.textContent = message;
  document.body.classList.add("is-locked");
  document.querySelector(".admin-header").inert = true;
  document.querySelector(".skip-link").inert = true;
  [...loginForm.querySelectorAll("a, input")].find(el => el.getClientRects().length)?.focus();
};
const revealAdmin = () => {
  loginLayer.hidden = true;
  adminPanel.hidden = false;
  adminShell.hidden = false;
  menuToggle.hidden = false;
  logoutButton.hidden = false;
  document.body.classList.remove("is-locked");
  document.querySelector(".admin-header").inert = false;
  document.querySelector(".skip-link").inert = false;
};

const showAdmin = async ({ knownAdmin = false } = {}) => {
  authenticated = knownAdmin;
  authRejected = false;
  adminPanel.inert = true;
  adminPanel.setAttribute("aria-busy", "true");
  if (knownAdmin) revealAdmin();
  try {
    await loadPage();
    if (authRejected) return false;
    if (!authenticated) throw new Error("Kirishni tekshirib bo‘lmadi. Qayta urinib ko‘ring.");
    revealAdmin();
    return true;
  } finally {
    adminPanel.inert = false;
    adminPanel.setAttribute("aria-busy", "false");
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (signingIn) return;
  signingIn = true;
  adminPassword = String(new FormData(loginForm).get("password") || "");
  loginStatus.textContent = "Tekshirilmoqda...";
  try {
    if (await showAdmin()) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, adminPassword);
      loginForm.reset();
    }
  } catch (error) {
    adminPassword = "";
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    showLogin(error.message);
  } finally {
    signingIn = false;
  }
});

logoutButton.addEventListener("click", () => {
  if (guards.isWorking?.() || (guards.isDirty?.() && !confirmDiscard())) return;
  leaving = true;
  adminPassword = "";
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.href = "/api/auth/logout?next=/admin";
});

export const initAdmin = async (loader, pageGuards = {}) => {
  // Old bookmarks resolve in the browser before authentication or task requests.
  const legacyPage = routes[location.hash.slice(1)];
  if (page === "stats" && legacyPage) {
    location.replace(legacyPage + location.search);
    return;
  }
  loadPage = loader;
  guards = pageGuards;
  const next = encodeURIComponent(location.pathname + location.search);
  googleSignin.href = `/api/auth/login?next=${next}`;
  telegramSignin.href = `/api/auth/telegram/start?next=${next}`;
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
    return showAdmin({ knownAdmin: true }).catch((error) => showLogin(error.message));
  }

  if (auth.user) {
    const who = auth.user.email || auth.user.phone || "Bu hisob";
    return showLogin(`${who} — bu hisobda admin huquqi yo‘q.`);
  }

  if (adminPassword) {
    return showAdmin().catch(() => {
      adminPassword = "";
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      showLogin("Qayta kiring.");
    });
  }

  showLogin();
  if (auth.telegramEnabled) window.NeoSportTelegram?.resume();
};
