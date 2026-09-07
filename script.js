document.documentElement.classList.add("js");

const header = document.querySelector("#site-header");
const menuButton = document.querySelector(".menu-toggle");
const menuLabel = menuButton?.querySelector(".sr-only");
const nav = document.querySelector("#site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const setMenuState = (open, restoreFocus = false) => {
  menuButton?.setAttribute("aria-expanded", String(open));
  menuButton?.setAttribute("aria-label", open ? "Menyuni yopish" : "Menyuni ochish");
  if (menuLabel) menuLabel.textContent = open ? "Menyuni yopish" : "Menyuni ochish";
  nav?.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);

  if (!open && restoreFocus) menuButton?.focus();
};

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  setMenuState(open);
});

navLinks.forEach((link) => link.addEventListener("click", () => setMenuState(false)));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || menuButton?.getAttribute("aria-expanded") !== "true") return;
  setMenuState(false, true);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900 && menuButton?.getAttribute("aria-expanded") === "true") {
    setMenuState(false);
  }
});

const updateHeader = () => {
  header?.classList.toggle("is-sticky", window.scrollY > 34);
};

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const sections = [...document.querySelectorAll("#shop, #new, #collection, #about, #store")];

if ("IntersectionObserver" in window) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
        });
      });
    },
    { rootMargin: "-45% 0px -50%", threshold: 0 }
  );

  sections.forEach((section) => sectionObserver.observe(section));
}

document.querySelectorAll("[data-analytics-location][data-analytics-destination]").forEach((link) => {
  link.addEventListener("click", () => {
    if (typeof window.va !== "function") return;

    window.va("event", {
      name: "outbound_click",
      data: {
        location: link.dataset.analyticsLocation,
        destination: link.dataset.analyticsDestination,
      },
    });
  });
});


const cartLayer = document.querySelector("#cart-layer");
const cartDrawer = document.querySelector("#cart-drawer");
const cartItemsElement = document.querySelector("#cart-items");
const cartEmptyElement = document.querySelector("#cart-empty");
const cartTotalElement = document.querySelector("#cart-total");
const cartToggles = [...document.querySelectorAll(".cart-toggle")];
const cartCountNodes = [...document.querySelectorAll(".cart-count")];
const checkoutForm = document.querySelector("#checkout-form");
const checkoutButton = document.querySelector("#checkout-button");
const checkoutStatus = document.querySelector("#checkout-status");
const catalogGrid = document.querySelector("#catalog-grid");
const catalogEmpty = document.querySelector("#catalog-empty");
const productModal = document.querySelector("#product-modal");
const productModalBody = document.querySelector("#product-modal-body");
const accountSlot = document.querySelector("#account");
const accountOrders = document.querySelector("#account-orders");
const accountOrdersBody = document.querySelector("#account-orders-body");
const CART_STORAGE_KEY = "neosport-cart-v1";

// Filled from /api/products; products are managed in the admin panel.
const catalogue = {};

const formatMoney = (amount) => `${new Intl.NumberFormat("uz-UZ").format(amount)} SO‘M`;
const cartItemKey = (item) => `${item.productId}|${item.color}|${item.size}`;
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const safeImageUrl = (value) => {
  const url = String(value || "");
  // The fallback has to be an asset the build actually ships.
  return /^(https:\/\/|\/|assets\/)/i.test(url) ? url : "assets/neosport-mark.webp";
};

const sanitizeCart = (value) => {
  if (!Array.isArray(value)) return [];

  return value.reduce((items, item) => {
    const product = catalogue[item?.productId];
    const quantity = Number(item?.quantity);
    if (
      !product ||
      !product.colors[item?.color] ||
      !product.sizes.includes(item?.size) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10
    ) {
      return items;
    }

    const existing = items.find((candidate) => cartItemKey(candidate) === cartItemKey(item));
    if (existing) existing.quantity = Math.min(10, existing.quantity + quantity);
    else items.push({ productId: item.productId, color: item.color, size: item.size, quantity });
    return items;
  }, []);
};

const readCart = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

const storedCart = readCart();
let cart = [];
let lastFocusedElement = null;
let closeCartTimer = null;

const productDetails = {};
let modalProductId = null;
let modalQuantity = 1;
let lastModalFocus = null;
let closeModalTimer = null;

const saveCart = () => {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // The cart still works for the current page when storage is unavailable.
  }
};

const renderCart = () => {
  if (!cartItemsElement || !cartEmptyElement || !cartTotalElement || !checkoutButton) return;

  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + catalogue[item.productId].price * item.quantity, 0);

  cartCountNodes.forEach((node) => {
    node.textContent = String(itemCount);
  });
  cartToggles.forEach((button) => {
    button.setAttribute("aria-label", `Savatchani ochish, ${itemCount} ta mahsulot`);
  });

  cartEmptyElement.hidden = cart.length > 0;
  checkoutButton.disabled = cart.length === 0;
  cartTotalElement.textContent = formatMoney(total);
  cartItemsElement.innerHTML = cart
    .map((item) => {
      const product = catalogue[item.productId];
      const color = product.colors[item.color];
      const key = cartItemKey(item);
      return `
        <article class="cart-item" data-cart-key="${escapeHtml(key)}">
          <img class="cart-item-image" src="${escapeHtml(safeImageUrl(color.image))}" alt="${escapeHtml(color.alt)}" width="1440" height="2560" />
          <div class="cart-item-info">
            <p class="cart-item-brand">${escapeHtml(product.brand.toUpperCase())}</p>
            <h3>${escapeHtml(product.name)}</h3>
            <p class="cart-item-variant">Rang: ${escapeHtml(color.label)}<br />O‘lcham: ${escapeHtml(item.size)}</p>
            <p class="cart-item-price">${formatMoney(product.price * item.quantity)}</p>
          </div>
          <div class="cart-item-actions">
            <button class="cart-remove" type="button" data-cart-action="remove" aria-label="${escapeHtml(product.name)}ni savatchadan o‘chirish">×</button>
            <div class="cart-quantity" aria-label="${escapeHtml(product.name)} soni">
              <button type="button" data-cart-action="decrease" aria-label="Soni kamaytirish">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-cart-action="increase" aria-label="Soni oshirish">+</button>
            </div>
          </div>
        </article>`;
    })
    .join("");
};

const openCart = () => {
  if (!cartLayer || !cartDrawer) return;
  if (closeCartTimer) window.clearTimeout(closeCartTimer);
  lastFocusedElement = document.activeElement;
  cartLayer.hidden = false;
  document.body.classList.add("cart-open");
  window.requestAnimationFrame(() => cartLayer.classList.add("is-open"));
  cartDrawer.querySelector(".cart-close")?.focus();
};

const closeCart = (restoreFocus = true) => {
  if (!cartLayer || cartLayer.hidden) return;
  cartLayer.classList.remove("is-open");
  document.body.classList.remove("cart-open");

  const finish = () => {
    cartLayer.hidden = true;
    if (restoreFocus && lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  };

  if (reduceMotion) finish();
  else closeCartTimer = window.setTimeout(finish, 290);
};

cartToggles.forEach((button) => button.addEventListener("click", openCart));

document.querySelectorAll("[data-cart-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const scrollToShop = button.hasAttribute("data-scroll-to-shop");
    closeCart(!scrollToShop);
    if (scrollToShop) {
      window.setTimeout(() => document.querySelector("#shop")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }), 300);
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (!cartLayer || cartLayer.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeCart();
    return;
  }

  if (event.key !== "Tab" || !cartDrawer) return;
  const focusable = [...cartDrawer.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

const normalizePublicProduct = (product) => {
  const id = String(product?.id || "");
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((size) => String(size)).filter((size) => /^[A-Z0-9]{1,4}$/.test(size)).slice(0, 12)
    : [];
  const colors = Array.isArray(product?.colors)
    ? product.colors
        .map((color) => ({
          id: String(color?.id || ""),
          label: String(color?.label || "").slice(0, 40),
          hex: /^#[0-9a-f]{6}$/i.test(String(color?.hex || "")) ? String(color.hex) : "#111111",
        }))
        .filter((color) => /^[a-z0-9-]{1,40}$/i.test(color.id) && color.label)
        .slice(0, 10)
    : [];
  const images = (Array.isArray(product?.images) ? product.images : [product?.imageUrl])
    .map((image) => safeImageUrl(image))
    .filter(Boolean)
    .slice(0, 10);
  const price = Number(product?.price);
  const discountPercent = Math.min(90, Math.max(0, Math.round(Number(product?.discountPercent)) || 0));

  if (!/^[a-z0-9-]{3,80}$/i.test(id) || !String(product?.name || "").trim() || !Number.isInteger(price) || price < 1000 || !sizes.length || !colors.length) {
    return null;
  }

  return {
    id,
    name: String(product.name).trim().slice(0, 100),
    brand: String(product.brand || "NeoSport").trim().slice(0, 60),
    category: String(product.category || "Kiyim").trim().slice(0, 40),
    description: String(product.description || "").trim().slice(0, 500),
    price,
    discountPercent,
    // The server is the authority on the discounted price; fall back to the
    // list price rather than recomputing it here.
    finalPrice: Number.isInteger(Number(product?.finalPrice)) ? Number(product.finalPrice) : price,
    sizes,
    colors,
    images,
    imageUrl: images[0] || safeImageUrl(product.imageUrl),
  };
};

const formatPlain = (amount) => new Intl.NumberFormat("uz-UZ").format(amount);

const priceMarkup = (product, className) =>
  product.discountPercent > 0
    ? `<span class="${className} is-discounted">${formatPlain(product.finalPrice)} <small>SO‘M</small><s>${formatPlain(product.price)}</s><b>−${product.discountPercent}%</b></span>`
    : `<span class="${className}">${formatPlain(product.price)} <small>SO‘M</small></span>`;

const renderCatalog = (products) => {
  if (!catalogGrid) return;
  if (catalogEmpty) catalogEmpty.hidden = products.length > 0;
  catalogGrid.innerHTML = products
    .map(
      (product) => `
        <article class="catalog-card">
          <button class="catalog-card-trigger" type="button" data-open-product="${escapeHtml(product.id)}" aria-label="${escapeHtml(product.name)} — rang va o‘lchamni tanlash">
            <span class="catalog-card-image">
              <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="720" height="900" loading="lazy" decoding="async" />
              <span class="catalog-card-category">${escapeHtml(product.category)}</span>
              <span class="catalog-card-view" aria-hidden="true">Tanlash</span>
            </span>
            <span class="catalog-card-body">
              <span class="catalog-card-brand">${escapeHtml(product.brand)}</span>
              <span class="catalog-card-name">${escapeHtml(product.name)}</span>
              <span class="catalog-card-description">${escapeHtml(product.description)}</span>
              ${priceMarkup(product, "catalog-card-price")}
            </span>
          </button>
        </article>`,
    )
    .join("");
};

const buildProductModal = (product) => {
  const colorOptions = product.colors
    .map(
      (color, index) => `
        <label class="color-option">
          <input type="radio" name="color" value="${escapeHtml(color.id)}" data-label="${escapeHtml(color.label)}"${color.image ? ` data-image="${escapeHtml(safeImageUrl(color.image))}"` : ""}${index === 0 ? " checked" : ""} />
          <span class="color-dot" style="background:${escapeHtml(color.hex)}" aria-hidden="true"></span><span>${escapeHtml(color.label)}</span>
        </label>`,
    )
    .join("");

  const sizeOptions = product.sizes
    .map(
      (size) => `<label><input type="radio" name="size" value="${escapeHtml(size)}" required /><span>${escapeHtml(size)}</span></label>`,
    )
    .join("");

  const firstColor = product.colors[0];

  return `
    <article class="pdp">
      <div class="pdp-media">
        <span class="pdp-badge">${escapeHtml(product.category)}</span>
        <img id="modal-product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="900" height="1120" decoding="async" />
        ${
          product.images.length > 1
            ? `<div class="pdp-thumbs" role="group" aria-label="Mahsulot rasmlari">${product.images
                .map(
                  (image, index) => `
            <button class="pdp-thumb${index === 0 ? " is-active" : ""}" type="button" data-thumb="${escapeHtml(image)}" aria-label="${index + 1}-rasmni ko‘rish">
              <img src="${escapeHtml(image)}" alt="" width="160" height="200" loading="lazy" decoding="async" />
            </button>`,
                )
                .join("")}</div>`
            : ""
        }
      </div>
      <div class="pdp-panel">
        <p class="pdp-brand">${escapeHtml(product.brand.toUpperCase())} · ${escapeHtml(product.category.toUpperCase())}</p>
        <h3 class="pdp-name" id="modal-product-name">${escapeHtml(product.name)}</h3>
        <div class="pdp-price">${
          product.discountPercent > 0
            ? `${formatPlain(product.finalPrice)} <small>so‘m</small><s>${formatPlain(product.price)}</s><b>−${product.discountPercent}%</b>`
            : `${formatPlain(product.price)} <small>so‘m</small>`
        }</div>
        <div class="pdp-stock"><i aria-hidden="true"></i> Sotuvda mavjud</div>
        ${product.description ? `<p class="pdp-desc">${escapeHtml(product.description)}</p>` : ""}
        <form class="product-order-form pdp-form" id="modal-product-form" data-product-id="${escapeHtml(product.id)}">
          <fieldset class="product-option-group color-options">
            <legend>RANG <span id="modal-selected-color">${escapeHtml((firstColor?.label || "").toUpperCase())}</span></legend>
            <div class="option-row">${colorOptions}</div>
          </fieldset>
          <fieldset class="product-option-group size-options">
            <legend>O‘LCHAM <span>BITTASINI TANLANG</span></legend>
            <div class="option-row">${sizeOptions}</div>
          </fieldset>
          <div class="pdp-buy">
            <div class="quantity-picker" aria-label="Mahsulot soni">
              <button type="button" data-quantity-action="decrease" aria-label="Soni kamaytirish">−</button>
              <output id="modal-product-quantity" aria-live="polite">1</output>
              <button type="button" data-quantity-action="increase" aria-label="Soni oshirish">+</button>
            </div>
            <button class="shop-add-button" type="submit">Savatchaga qo‘shish</button>
          </div>
          <p class="product-form-status" id="modal-form-status" role="status" aria-live="polite"></p>
        </form>
        <ul class="pdp-perks">
          <li><b>↗</b> Buyurtma Telegram bot orqali xavfsiz qabul qilinadi</li>
          <li><b>◇</b> Rang va o‘lcham — o‘zingizga mos variantni tanlang</li>
          <li><b>◎</b> Namangan bo‘ylab yetkazib berish</li>
        </ul>
      </div>
    </article>`;
};

const openProductModal = (productId) => {
  const product = productDetails[productId];
  if (!product || !productModal || !productModalBody) return;
  if (closeModalTimer) window.clearTimeout(closeModalTimer);

  modalProductId = productId;
  modalQuantity = 1;
  productModalBody.innerHTML = buildProductModal(product);

  lastModalFocus = document.activeElement;
  productModal.hidden = false;
  document.body.classList.add("cart-open");
  window.requestAnimationFrame(() => productModal.classList.add("is-open"));
  productModal.querySelector(".product-modal-close")?.focus();
};

const closeProductModal = (restoreFocus = true) => {
  if (!productModal || productModal.hidden) return;
  productModal.classList.remove("is-open");
  if (!document.querySelector(".cart-layer:not([hidden])")) document.body.classList.remove("cart-open");

  const finish = () => {
    productModal.hidden = true;
    productModalBody.innerHTML = "";
    modalProductId = null;
    if (restoreFocus && lastModalFocus instanceof HTMLElement) lastModalFocus.focus();
  };

  if (reduceMotion) finish();
  else closeModalTimer = window.setTimeout(finish, 280);
};

catalogGrid?.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-open-product]");
  if (!trigger) return;
  openProductModal(trigger.dataset.openProduct);
});

productModal?.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-close]")) closeProductModal();
});

productModal?.addEventListener("click", (event) => {
  const thumb = event.target.closest("[data-thumb]");
  if (!thumb) return;

  const image = productModal.querySelector("#modal-product-image");
  if (image) image.src = thumb.dataset.thumb;
  productModal.querySelectorAll(".pdp-thumb").forEach((button) => button.classList.toggle("is-active", button === thumb));
});

productModal?.addEventListener("change", (event) => {
  const input = event.target;
  if (input.name !== "color" || !input.checked) return;
  const label = productModal.querySelector("#modal-selected-color");
  if (label) label.textContent = String(input.dataset.label || "").toUpperCase();

  const image = productModal.querySelector("#modal-product-image");
  if (image && input.dataset.image) {
    image.src = input.dataset.image;
    if (!reduceMotion && typeof image.animate === "function") {
      image.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
    }
  }
});

productModal?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quantity-action]");
  if (!button) return;
  const delta = button.dataset.quantityAction === "increase" ? 1 : -1;
  modalQuantity = Math.max(1, Math.min(10, modalQuantity + delta));
  const output = productModal.querySelector("#modal-product-quantity");
  if (output) output.textContent = String(modalQuantity);
});

productModal?.addEventListener("submit", (event) => {
  const form = event.target.closest("#modal-product-form");
  if (!form) return;
  event.preventDefault();

  const formData = new FormData(form);
  const productId = form.dataset.productId;
  const color = String(formData.get("color") || "");
  const size = String(formData.get("size") || "");
  const product = catalogue[productId];
  const status = productModal.querySelector("#modal-form-status");

  if (!product || !product.colors[color]) return;
  if (!product.sizes.includes(size)) {
    if (status) status.textContent = "Iltimos, o‘lchamni tanlang.";
    form.querySelector('input[name="size"]')?.focus();
    return;
  }

  const nextItem = { productId, color, size, quantity: modalQuantity };
  const existing = cart.find((item) => cartItemKey(item) === cartItemKey(nextItem));
  if (existing) existing.quantity = Math.min(10, existing.quantity + modalQuantity);
  else cart.push(nextItem);

  saveCart();
  renderCart();

  if (typeof window.va === "function") {
    window.va("event", { name: "add_to_cart", data: { product: productId, color, size } });
  }

  // Hide the modal instantly (it sits above the cart) before revealing the cart.
  if (closeModalTimer) window.clearTimeout(closeModalTimer);
  productModal.classList.remove("is-open");
  productModal.hidden = true;
  productModalBody.innerHTML = "";
  modalProductId = null;
  openCart();
});

document.addEventListener("keydown", (event) => {
  if (!productModal || productModal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeProductModal();
    return;
  }

  if (event.key !== "Tab") return;
  const dialog = productModal.querySelector(".product-modal-dialog");
  const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || [])];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

/* ------------------------------------------------------------ the account -- */

const GOOGLE_MARK = `
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>`;

let account = null;

const renderAccount = ({ user, googleEnabled }) => {
  if (!accountSlot) return;
  const next = encodeURIComponent(accountSlot.dataset.next || "/");

  // With Google sign-in switched off there is nothing to offer, so the slot
  // stays out of the header rather than showing a dead button.
  if (!user && !googleEnabled) {
    accountSlot.hidden = true;
    return;
  }

  accountSlot.hidden = false;
  accountSlot.innerHTML = user
    ? `<span class="account-user">
        ${user.picture ? `<img src="${escapeHtml(user.picture)}" alt="" width="24" height="24" referrerpolicy="no-referrer" />` : ""}
        <span class="account-name">${escapeHtml(user.name || user.email)}</span>
      </span>
      <a class="account-logout" href="/api/auth/logout?next=${next}">Chiqish</a>`
    : `<a class="account-signin" href="/api/auth/login?next=${next}">${GOOGLE_MARK}<span>Kirish</span></a>`;
};

const renderAccountOrders = (orders) => {
  if (!accountOrders || !accountOrdersBody) return;
  accountOrders.hidden = false;

  if (orders.length === 0) {
    accountOrdersBody.innerHTML = '<p class="account-orders-empty">Hali buyurtma bermagansiz.</p>';
    return;
  }

  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(date);
  };

  accountOrdersBody.innerHTML = orders
    .map(
      (order) => `
        <article class="account-order">
          <div class="account-order-head">
            <b>${escapeHtml(order.id)}</b>
            <span>${escapeHtml(formatDate(order.createdAt))}</span>
          </div>
          <ul>${order.items
            .map(
              (item) =>
                `<li>${escapeHtml(item.name)} · ${escapeHtml(item.color)} · ${escapeHtml(item.size)} · ${item.quantity} dona</li>`,
            )
            .join("")}</ul>
          <strong>${formatMoney(order.total)}</strong>
        </article>`,
    )
    .join("");
};

const loadAccountOrders = async () => {
  if (!accountOrdersBody) return;
  try {
    const response = await fetch("/api/orders", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const result = await response.json();
    renderAccountOrders(result.orders || []);
  } catch (error) {
    console.warn(error.message);
  }
};

const loadAccount = async () => {
  if (!accountSlot) return;
  try {
    const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const result = await response.json();
    account = result.user || null;
    renderAccount(result);

    if (!account) return;
    // Google gives us a name but never a phone number, so only one field fills in.
    const nameInput = checkoutForm?.elements.namedItem("name");
    if (nameInput && !nameInput.value) nameInput.value = account.name || "";
    await loadAccountOrders();
  } catch (error) {
    console.warn(error.message);
  }
};

// The sign-in redirect comes back with a flag rather than an error page.
const authNotice = new URLSearchParams(window.location.search).get("auth");
if (authNotice && checkoutStatus) {
  checkoutStatus.textContent =
    authNotice === "bekor" ? "Kirish bekor qilindi." : "Kirishda xatolik yuz berdi. Qayta urinib ko‘ring.";
}

const loadProducts = async () => {
  const loadedProducts = [];
  try {
    const response = await fetch("/api/products", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Mahsulotlarni yuklab bo‘lmadi.");
    const result = await response.json();
    for (const item of result.products || []) {
      const product = normalizePublicProduct(item);
      if (!product) continue;
      loadedProducts.push(product);
      productDetails[product.id] = product;
      catalogue[product.id] = {
        name: product.name,
        brand: product.brand,
        // Cart totals follow the price the customer is actually charged.
        price: product.finalPrice,
        sizes: product.sizes,
        colors: Object.fromEntries(
          product.colors.map((color) => [
            color.id,
            { label: color.label, image: product.imageUrl, alt: `${product.name}, ${color.label} rang` },
          ]),
        ),
      };
    }
    renderCatalog(loadedProducts);
  } catch (error) {
    console.warn(error.message);
    renderCatalog([]);
  } finally {
    cart = sanitizeCart([...storedCart, ...cart]);
    saveCart();
    renderCart();
  }
};

cartItemsElement?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-action]");
  const itemElement = button?.closest("[data-cart-key]");
  if (!button || !itemElement) return;

  const index = cart.findIndex((item) => cartItemKey(item) === itemElement.dataset.cartKey);
  if (index < 0) return;

  if (button.dataset.cartAction === "remove") cart.splice(index, 1);
  if (button.dataset.cartAction === "increase") cart[index].quantity = Math.min(10, cart[index].quantity + 1);
  if (button.dataset.cartAction === "decrease") {
    cart[index].quantity -= 1;
    if (cart[index].quantity < 1) cart.splice(index, 1);
  }

  saveCart();
  renderCart();
});

checkoutForm?.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    if (checkoutStatus) {
      checkoutStatus.textContent = "";
      checkoutStatus.classList.remove("is-success");
    }
  });
});

checkoutForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!checkoutButton || cart.length === 0) return;

  const formData = new FormData(checkoutForm);
  const nameInput = checkoutForm.elements.namedItem("name");
  const phoneInput = checkoutForm.elements.namedItem("phone");
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");

  if (name.length < 2) nameInput?.setCustomValidity("Ismingizni kiriting.");
  if (phoneDigits.length < 9 || phoneDigits.length > 15) phoneInput?.setCustomValidity("To‘g‘ri telefon raqamini kiriting.");

  if (!checkoutForm.checkValidity()) {
    checkoutForm.querySelectorAll(":invalid").forEach((input) => input.setAttribute("aria-invalid", "true"));
    checkoutForm.reportValidity();
    return;
  }

  checkoutButton.disabled = true;
  checkoutButton.setAttribute("aria-busy", "true");
  const originalButtonText = checkoutButton.querySelector("span")?.textContent;
  if (checkoutButton.querySelector("span")) checkoutButton.querySelector("span").textContent = "Yuborilmoqda...";
  if (checkoutStatus) {
    checkoutStatus.textContent = "";
    checkoutStatus.classList.remove("is-success");
  }

  try {
    const response = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        website: String(formData.get("website") || ""),
        items: cart,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Buyurtmani yuborib bo‘lmadi. Qayta urinib ko‘ring.");

    cart = [];
    saveCart();
    renderCart();
    checkoutForm.reset();
    if (checkoutStatus) {
      checkoutStatus.textContent = `Buyurtma qabul qilindi. Raqami: ${result.orderId}`;
      checkoutStatus.classList.add("is-success");
    }
    if (typeof window.va === "function") window.va("event", { name: "order_submitted" });
  } catch (error) {
    if (checkoutStatus) checkoutStatus.textContent = error.message;
  } finally {
    checkoutButton.disabled = cart.length === 0;
    checkoutButton.removeAttribute("aria-busy");
    if (checkoutButton.querySelector("span")) checkoutButton.querySelector("span").textContent = originalButtonText;
  }
});

if (catalogGrid || cartItemsElement) loadProducts();
loadAccount();

const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
