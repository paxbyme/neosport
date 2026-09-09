document.documentElement.classList.add("js");

const header = document.querySelector("#site-header");
const menuButton = document.querySelector(".menu-toggle");
const menuLabel = menuButton?.querySelector(".sr-only");
const nav = document.querySelector("#site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a, .sidebar-nav a, .sidebar-contact")];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isShopPage = document.body.classList.contains("shop-page");
const desktopCartMedia = window.matchMedia("(min-width: 1200px)");
const hasDesktopCart = () => isShopPage && desktopCartMedia.matches;
const menuBackdrop = document.querySelector(".menu-backdrop");
let inertElements = [];

// Inert siblings at every ancestor level also cover drawers inside the shop grid.
const isolateSurface = (surface) => {
  inertElements.forEach(([element, wasInert]) => { element.inert = wasInert; });
  inertElements = [];
  for (let node = surface; node && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.tagName === "SCRIPT") continue;
      inertElements.push([sibling, sibling.inert]);
      sibling.inert = true;
    }
  }
};

const trapFocus = (event, surface) => {
  if (event.key !== "Tab") return;
  const focusable = [...surface.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getClientRects().length && element.tabIndex !== -1);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === surface)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === surface)) {
    event.preventDefault(); first.focus();
  }
};

const setMenuState = (open, restoreFocus = false) => {
  menuButton?.setAttribute("aria-expanded", String(open));
  menuButton?.setAttribute("aria-label", open ? "Menyuni yopish" : "Menyuni ochish");
  if (menuLabel) menuLabel.textContent = open ? "Menyuni yopish" : "Menyuni ochish";
  nav?.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
  if (menuBackdrop) menuBackdrop.hidden = !open;
  if (open) {
    nav?.setAttribute("role", "dialog");
    nav?.setAttribute("aria-modal", "true");
    isolateSurface(nav);
    nav?.querySelector("button, a")?.focus();
  } else {
    nav?.removeAttribute("role");
    nav?.removeAttribute("aria-modal");
    isolateSurface(null);
  }
  if (!open && restoreFocus) menuButton?.focus();
};

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  setMenuState(open);
});

navLinks.forEach((link) => link.addEventListener("click", () => setMenuState(false)));
document.querySelectorAll("[data-menu-close]").forEach((button) => button.addEventListener("click", () => setMenuState(false, true)));

document.addEventListener("keydown", (event) => {
  if (menuButton?.getAttribute("aria-expanded") === "true" && nav) trapFocus(event, nav);
  if (event.key !== "Escape" || menuButton?.getAttribute("aria-expanded") !== "true") return;
  setMenuState(false, true);
});

window.addEventListener("resize", () => {
  if (window.innerWidth >= (isShopPage ? 768 : 901) && menuButton?.getAttribute("aria-expanded") === "true") {
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
const footerLinks = document.querySelector(".footer-links");
const CART_STORAGE_KEY = "neosport-cart-v1";

// Filled from /api/products; products are managed in the admin panel.
const catalogue = {};

const formatMoney = (amount) => `${new Intl.NumberFormat("uz-UZ").format(amount)} so‘m`;
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
let toastTimer = null;
const announce = (message) => {
  const toast = document.querySelector("#storefront-toast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toastTimer = window.setTimeout(() => { toast.textContent = ""; }, 3500);
};

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
  checkoutForm.querySelector(".checkout-fields").hidden = cart.length === 0;
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
            <p class="cart-item-variant">${escapeHtml(color.label)} · ${escapeHtml(item.size)}</p>
            <div class="cart-quantity" role="group" aria-label="${escapeHtml(product.name)} soni">
              <button type="button" data-cart-action="decrease" aria-label="Soni kamaytirish" title="Kamaytirish"${item.quantity === 1 ? " disabled" : ""}>${icon("minus")}</button>
              <span>${item.quantity}</span>
              <button type="button" data-cart-action="increase" aria-label="Soni oshirish" title="Oshirish"${item.quantity === 10 ? " disabled" : ""}>${icon("plus")}</button>
            </div>
            <p class="cart-item-price">${formatMoney(product.price * item.quantity)}</p>
          </div>
          <button class="cart-remove icon-button" type="button" data-cart-action="remove" aria-label="${escapeHtml(product.name)}ni savatchadan o‘chirish" title="O‘chirish">${icon("trash-2")}</button>
        </article>`;
    })
    .join("");
};

const openCart = () => {
  if (!cartLayer || !cartDrawer) return;
  if (hasDesktopCart()) {
    document.body.classList.remove("cart-open");
    isolateSurface(null);
    return;
  }
  if (closeCartTimer) window.clearTimeout(closeCartTimer);
  lastFocusedElement = document.activeElement;
  cartLayer.hidden = false;
  document.body.classList.add("cart-open");
  isolateSurface(cartLayer);
  window.requestAnimationFrame(() => cartLayer.classList.add("is-open"));
  cartDrawer.querySelector(".cart-close")?.focus();
};

const closeCart = (restoreFocus = true) => {
  if (!cartLayer || cartLayer.hidden || hasDesktopCart()) return;
  cartLayer.classList.remove("is-open");
  document.body.classList.remove("cart-open");
  isolateSurface(null);

  const finish = () => {
    cartLayer.hidden = true;
    if (restoreFocus && lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  };

  if (reduceMotion) finish();
  else closeCartTimer = window.setTimeout(finish, 180);
};

const syncCartLayout = () => {
  if (!cartLayer || !cartDrawer) return;
  window.clearTimeout(closeCartTimer);
  const wasOpen = document.body.classList.contains("cart-open") && productModal.hidden;
  if (hasDesktopCart()) {
    cartLayer.hidden = false;
    cartDrawer.setAttribute("role", "complementary");
    cartDrawer.removeAttribute("aria-modal");
    cartLayer.classList.remove("is-open");
    if (wasOpen) { document.body.classList.remove("cart-open"); isolateSurface(null); cartDrawer.focus(); }
  } else {
    cartDrawer.setAttribute("role", "dialog");
    cartDrawer.setAttribute("aria-modal", "true");
    if (!wasOpen) {
      cartLayer.hidden = true;
      if (cartDrawer.contains(document.activeElement)) cartToggles[0]?.focus();
    }
  }
};
desktopCartMedia.addEventListener("change", syncCartLayout);
syncCartLayout();

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
  if (!cartLayer || cartLayer.hidden || hasDesktopCart() || !productModal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeCart();
    return;
  }

  if (cartDrawer) trapFocus(event, cartDrawer);
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
  product.discountPercent > 0 && product.finalPrice < product.price
    ? `<span class="${className} is-discounted">${formatPlain(product.finalPrice)} <small>so‘m</small><s>${formatMoney(product.price)}</s></span>`
    : `<span class="${className}">${formatPlain(product.finalPrice)} <small>so‘m</small></span>`;

let allProducts = [];
let selectedCategory = "";
let catalogFailed = false;
const searchInput = document.querySelector("#catalog-search");
const sizeFilter = document.querySelector("#size-filter");
const sortSelect = document.querySelector("#catalog-sort");
const categoryChips = document.querySelector("#category-chips");
const normalizeSearch = (value) => String(value).toLocaleLowerCase("uz").normalize("NFKC").replace(/[‘’ʻʼ`']/g, "");

const productCard = (product) => `
  <article class="catalog-card">
    <button class="catalog-card-trigger" type="button" data-open-product="${escapeHtml(product.id)}" aria-label="${escapeHtml(product.name)} — rasmlar va tafsilotlar">
      <span class="catalog-card-image"><img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="720" height="720" loading="lazy" decoding="async" />${product.discountPercent > 0 && product.finalPrice < product.price ? `<span class="catalog-discount">−${product.discountPercent}%</span>` : ""}</span>
    </button>
    <div class="catalog-card-body">
      <p class="catalog-card-brand"><span>${escapeHtml(product.brand)}</span><span>${escapeHtml(product.category)}</span></p>
      <h3 class="catalog-card-name">${escapeHtml(product.name)}</h3>
      ${priceMarkup(product, "catalog-card-price")}
      <div class="catalog-card-variants"><span>${escapeHtml(product.sizes.slice(0, 3).join(" · "))}${product.sizes.length > 3 ? ` · +${product.sizes.length - 3}` : ""}</span><span class="card-colors" aria-label="${escapeHtml(product.colors.map((color) => color.label).join(", "))}">${product.colors.slice(0, 3).map((color) => `<span class="card-color" style="background:${escapeHtml(color.hex)}" title="${escapeHtml(color.label)}"></span>`).join("")}${product.colors.length > 3 ? `+${product.colors.length - 3}` : ""}</span></div>
      <button class="catalog-card-action" type="button" data-open-product="${escapeHtml(product.id)}" aria-label="${escapeHtml(product.name)} — rang va o‘lchamni tanlash">Tanlash ${icon("plus")}</button>
    </div>
  </article>`;

const renderEmptyCatalog = (hasFilters) => {
  if (!catalogEmpty) return;
  catalogEmpty.innerHTML = `${icon(catalogFailed ? "rotate-ccw" : "package-open")}<h3>${catalogFailed ? "Mahsulotlar yuklanmadi" : hasFilters ? "Mos mahsulot topilmadi" : "Hozircha mahsulot yo‘q"}</h3><p>${catalogFailed ? "Ulanishni tekshirib, yana urinib ko‘ring." : hasFilters ? "Boshqa nom yoki o‘lcham bilan qidirib ko‘ring." : "Mavjud modellar haqida Instagram sahifamizda so‘rashingiz mumkin."}</p>${catalogFailed ? '<button class="text-button" type="button" data-catalog-retry>Qayta urinish</button>' : hasFilters ? '<button class="text-button" type="button" data-reset-filters>Filtrlarni tozalash</button>' : '<a class="text-button" href="https://www.instagram.com/neosport_namangan/" target="_blank" rel="noopener noreferrer">Instagramda ko‘rish</a>'}`;
};

const renderCatalog = (products) => {
  if (!catalogGrid) return;
  if (catalogEmpty) catalogEmpty.hidden = products.length > 0;
  catalogGrid.innerHTML = (isShopPage ? products : products.slice(0, 4)).map(productCard).join("");
  catalogGrid.setAttribute("aria-busy", "false");
};

const applyFilters = () => {
  const query = normalizeSearch(searchInput?.value.trim() || "");
  const size = sizeFilter?.value || "";
  let products = allProducts.filter((product) => (!selectedCategory || product.category === selectedCategory) && (!size || product.sizes.includes(size)) && (!query || normalizeSearch(`${product.name} ${product.brand}`).includes(query)));
  if (sortSelect?.value === "price-asc") products.sort((a, b) => a.finalPrice - b.finalPrice);
  if (sortSelect?.value === "price-desc") products.sort((a, b) => b.finalPrice - a.finalPrice);
  if (sortSelect?.value === "name") products.sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  renderCatalog(products);
  const count = document.querySelector("#catalog-count");
  if (count) count.textContent = catalogFailed ? "Yuklashda xatolik" : `${products.length} ta mahsulot`;
  const hasFilters = Boolean(query || size || selectedCategory);
  const activeFilters = document.querySelector("#active-filters");
  if (activeFilters) {
    activeFilters.hidden = !hasFilters;
    document.querySelector("#active-filter-label").textContent = [selectedCategory, size && `O‘lcham: ${size}`, query && `Qidiruv: ${searchInput.value.trim()}`].filter(Boolean).join(" · ");
  }
  const clearSearch = document.querySelector("#search-clear");
  if (clearSearch) clearSearch.hidden = !query;
  categoryChips?.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.category === selectedCategory)));
  renderEmptyCatalog(hasFilters);
};

const renderFilters = () => {
  if (!categoryChips || !sizeFilter) return;
  const categories = [...new Set(allProducts.map((product) => product.category))];
  categoryChips.innerHTML = ["", ...categories].map((category) => `<button class="category-chip" type="button" data-category="${escapeHtml(category)}" aria-pressed="${category === selectedCategory}">${category ? escapeHtml(category) : `${icon("layout-grid")} Barchasi`}<b>${category ? allProducts.filter((product) => product.category === category).length : allProducts.length}</b></button>`).join("");
  const sizes = [...new Set(allProducts.flatMap((product) => product.sizes))];
  const clothingOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
  sizes.sort((a, b) => clothingOrder.includes(a) && clothingOrder.includes(b) ? clothingOrder.indexOf(a) - clothingOrder.indexOf(b) : a.localeCompare(b, "uz", { numeric: true }));
  sizeFilter.innerHTML = '<option value="">Barcha o‘lchamlar</option>' + sizes.map((size) => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join("");
  document.querySelector("#sidebar-count").textContent = String(allProducts.length);
};

const resetFilters = () => {
  selectedCategory = "";
  if (searchInput) searchInput.value = "";
  if (sizeFilter) sizeFilter.value = "";
  if (sortSelect) sortSelect.value = "default";
  applyFilters();
  searchInput?.focus();
};
searchInput?.addEventListener("input", applyFilters);
sizeFilter?.addEventListener("change", applyFilters);
sortSelect?.addEventListener("change", applyFilters);
categoryChips?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  applyFilters();
});
document.querySelector("#reset-filters")?.addEventListener("click", resetFilters);
document.querySelector("#search-clear")?.addEventListener("click", () => { searchInput.value = ""; applyFilters(); searchInput.focus(); });
catalogEmpty?.addEventListener("click", (event) => {
  if (event.target.closest("[data-reset-filters]")) resetFilters();
  if (event.target.closest("[data-catalog-retry]")) loadProducts();
});

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
        <img id="modal-product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" width="900" height="1120" decoding="async" />
        ${
          product.images.length > 1
            ? `<div class="pdp-thumbs" role="group" aria-label="Mahsulot rasmlari">${product.images
                .map(
                  (image, index) => `
            <button class="pdp-thumb${index === 0 ? " is-active" : ""}" type="button" data-thumb="${escapeHtml(image)}" aria-pressed="${index === 0}" aria-label="${index + 1}-rasmni ko‘rish">
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
          product.discountPercent > 0 && product.finalPrice < product.price
            ? `${formatPlain(product.finalPrice)} <small>so‘m</small><s>${formatPlain(product.price)}</s><b>−${product.discountPercent}%</b>`
            : `${formatPlain(product.price)} <small>so‘m</small>`
        }</div>
        <div class="pdp-stock">${icon("check")} Sotuvda mavjud</div>
        ${product.description ? `<p class="pdp-desc">${escapeHtml(product.description)}</p>` : ""}
        <form class="product-order-form pdp-form" id="modal-product-form" data-product-id="${escapeHtml(product.id)}" novalidate>
          <fieldset class="product-option-group color-options">
            <legend>Rang <span id="modal-selected-color">${escapeHtml(firstColor?.label || "")}</span></legend>
            <div class="option-row">${colorOptions}</div>
          </fieldset>
          <fieldset class="product-option-group size-options">
            <legend>O‘lcham <span>Tanlang</span></legend>
            <div class="option-row">${sizeOptions}</div>
          </fieldset>
          <div class="pdp-buy">
            <div class="quantity-picker" role="group" aria-label="Mahsulot soni">
              <button type="button" data-quantity-action="decrease" aria-label="Soni kamaytirish" title="Kamaytirish" disabled>${icon("minus")}</button>
              <output id="modal-product-quantity" aria-live="polite">1</output>
              <button type="button" data-quantity-action="increase" aria-label="Soni oshirish" title="Oshirish">${icon("plus")}</button>
            </div>
            <button class="shop-add-button" type="submit" aria-disabled="true" aria-describedby="modal-form-status">Savatchaga qo‘shish</button>
          </div>
          <p class="product-form-status" id="modal-form-status" role="status" aria-live="polite">O‘lchamni tanlang.</p>
        </form>
        <ul class="pdp-perks">
          <li>${icon("map-pin")} Namangandagi do‘konimizda kiyib ko‘ring.</li>
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
  isolateSurface(productModal);
  window.requestAnimationFrame(() => productModal.classList.add("is-open"));
  productModal.querySelector(".product-modal-close")?.focus();
};

const closeProductModal = (restoreFocus = true) => {
  if (!productModal || productModal.hidden) return;
  productModal.classList.remove("is-open");
  document.body.classList.remove("cart-open");
  isolateSurface(null);

  const finish = () => {
    productModal.hidden = true;
    productModalBody.innerHTML = "";
    modalProductId = null;
    if (restoreFocus && lastModalFocus instanceof HTMLElement) lastModalFocus.focus();
  };

  if (reduceMotion) finish();
  else closeModalTimer = window.setTimeout(finish, 180);
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
  productModal.querySelectorAll(".pdp-thumb").forEach((button) => { button.classList.toggle("is-active", button === thumb); button.setAttribute("aria-pressed", String(button === thumb)); });
});

productModal?.addEventListener("change", (event) => {
  const input = event.target;
  if (input.name === "size" && input.checked) {
    productModal.querySelector(".shop-add-button").setAttribute("aria-disabled", "false");
    productModal.querySelector("#modal-form-status").textContent = `Tanlangan o‘lcham: ${input.value}`;
  }
  if (input.name !== "color" || !input.checked) return;
  const label = productModal.querySelector("#modal-selected-color");
  if (label) label.textContent = String(input.dataset.label || "");

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
  productModal.querySelector('[data-quantity-action="decrease"]').disabled = modalQuantity === 1;
  productModal.querySelector('[data-quantity-action="increase"]').disabled = modalQuantity === 10;
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
  isolateSurface(null);
  document.body.classList.remove("cart-open");
  lastModalFocus?.focus();
  openCart();
  if (hasDesktopCart()) announce("Mahsulot savatchaga qo‘shildi.");
});

document.addEventListener("keydown", (event) => {
  if (!productModal || productModal.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeProductModal();
    return;
  }

  const dialog = productModal.querySelector(".product-modal-dialog");
  if (dialog) trapFocus(event, dialog);
});

/* ------------------------------------------------------------ the account -- */

const GOOGLE_MARK = `
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>`;

const TELEGRAM_MARK = `
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="#2AABEE" d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Z" />
    <path fill="#fff" d="M16.906 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>`;

// The session stores digits only; the form shows the number the way it is
// written locally, and the server normalizes it back on submit.
const formatPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return /^998\d{9}$/.test(digits)
    ? `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`
    : digits && `+${digits}`;
};

let account = null;

const renderAccount = ({ user, googleEnabled, telegramEnabled }) => {
  if (!accountSlot) return;
  const next = encodeURIComponent(accountSlot.dataset.next || "/");

  // With no sign-in method configured there is nothing to offer, so the slot
  // stays out of the header rather than showing a dead button.
  if (!user && !googleEnabled && !telegramEnabled) {
    accountSlot.hidden = true;
    return;
  }

  accountSlot.hidden = false;
  if (user) {
    accountSlot.innerHTML = `<span class="account-user">
        ${user.picture ? `<img src="${escapeHtml(user.picture)}" alt="" width="24" height="24" referrerpolicy="no-referrer" />` : ""}
        <span class="account-name">${escapeHtml(user.name || user.email || formatPhone(user.phone))}</span>
      </span>
      <a class="account-logout" href="/api/auth/logout?next=${next}">Chiqish</a>`;
    return;
  }

  accountSlot.innerHTML = [
    googleEnabled ? `<a class="account-signin" href="/api/auth/login?next=${next}" aria-label="Google orqali kirish" title="Google orqali kirish">${GOOGLE_MARK}<span>Kirish</span></a>` : "",
    telegramEnabled
      ? `<a class="account-signin" data-telegram-signin href="/api/auth/telegram/start?next=${next}" aria-label="Telegram orqali kirish" title="Telegram orqali kirish">${TELEGRAM_MARK}<span>Telegram</span></a>`
      : "",
  ].join("");
};

/**
 * Customers are never told the panel exists: the footer link is built here,
 * and only once /api/auth/me reports an admin session. The panel itself is
 * guarded by requireAdmin, so this only keeps the door out of sight.
 */
const renderAdminLink = (user) => {
  const existing = footerLinks?.querySelector("[data-admin-link]");
  if (!footerLinks || user?.role !== "admin") {
    existing?.remove();
    return;
  }
  if (existing) return;

  const link = document.createElement("a");
  link.href = "/admin";
  link.rel = "nofollow";
  link.dataset.adminLink = "";
  link.textContent = "Admin";
  footerLinks.append(link);
};

/**
 * The bot conversation happens in another tab, so this page asks the server
 * whether the token it holds has been verified. The token is in an HttpOnly
 * cookie, which is why the server reports `waiting` instead of the page
 * looking for itself.
 */
const checkTelegramLogin = async () => {
  try {
    const response = await fetch("/api/auth/telegram/status", { headers: { Accept: "application/json" } });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.ready) {
      window.location.href = result.next || "/";
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
  if (checkoutStatus) checkoutStatus.textContent = "Telegram’da telefon raqamingizni ulashing — sahifa o‘zi yangilanadi.";

  // Ten minutes, matching how long the login token stays valid.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    if (!(await checkTelegramLogin())) break;
  }
  telegramPolling = false;
};

accountSlot?.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-telegram-signin]");
  if (!trigger) return;
  event.preventDefault();
  // Opened in a new tab so this one stays alive to notice the result.
  window.open(trigger.href, "_blank", "noopener");
  waitForTelegram();
});

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
    renderAdminLink(account);

    // Returning to this tab after talking to the bot: pick the flow back up.
    if (!account) {
      if (result.telegramEnabled) window.NeoSportTelegram?.resume();
      return;
    }
    // Whatever the account knows, the customer should not have to retype.
    // Google gives a name only; a Telegram sign-up gives a verified phone too.
    const nameInput = checkoutForm?.elements.namedItem("name");
    if (nameInput && !nameInput.value) nameInput.value = account.name || "";
    const phoneInput = checkoutForm?.elements.namedItem("phone");
    if (phoneInput && !phoneInput.value && account.phone) phoneInput.value = formatPhone(account.phone);
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
  announce(checkoutStatus.textContent);
}

let cartHydrated = false;
const loadProducts = async () => {
  const loadedProducts = [];
  catalogFailed = false;
  const catalogCount = document.querySelector("#catalog-count");
  if (catalogCount) catalogCount.textContent = "Yuklanmoqda...";
  if (catalogEmpty) catalogEmpty.hidden = true;
  if (catalogGrid) {
    catalogGrid.setAttribute("aria-busy", "true");
    catalogGrid.innerHTML = Array.from({ length: isShopPage ? 3 : 4 }, () => '<div class="catalog-skeleton" aria-hidden="true"><div></div><span></span><span></span></div>').join("");
  }
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
    allProducts = loadedProducts;
    renderFilters();
    applyFilters();
    cart = sanitizeCart(cartHydrated ? cart : storedCart);
    cartHydrated = true;
    saveCart();
  } catch (error) {
    console.warn(error.message);
    catalogFailed = true;
    allProducts = [];
    applyFilters();
  } finally {
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
  const remainingItem = [...cartItemsElement.querySelectorAll("[data-cart-key]")].find((element) => element.dataset.cartKey === itemElement.dataset.cartKey);
  const nextFocus = remainingItem?.querySelector(`[data-cart-action="${button.dataset.cartAction}"]:not([disabled])`) || remainingItem?.querySelector("button:not([disabled])") || cartItemsElement.querySelector("button:not([disabled])") || (hasDesktopCart() ? searchInput : cartDrawer.querySelector(".cart-close"));
  nextFocus?.focus();
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

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest(".catalog-card, .pdp, .cart-item") || image.dataset.fallback) return;
  image.dataset.fallback = "true";
  image.src = "assets/neosport-mark.webp";
  image.alt = "Mahsulot rasmi hozircha yuklanmadi";
}, true);

const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
