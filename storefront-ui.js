// Shared shopping surfaces keep the same checkout and variant flow on both pages.
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="assets/icons.svg#${name}" /></svg>`;

document.body.insertAdjacentHTML("beforeend", `
  <div class="product-modal" id="product-modal" hidden>
    <button class="product-modal-backdrop" type="button" data-modal-close aria-label="Oynani yopish" tabindex="-1"></button>
    <div class="product-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-product-name" tabindex="-1">
      <button class="product-modal-close icon-button" type="button" data-modal-close aria-label="Oynani yopish" title="Yopish">${icon("x")}</button>
      <div class="product-modal-body" id="product-modal-body"></div>
    </div>
  </div>
  <div class="cart-layer" id="cart-layer" hidden>
    <button class="cart-backdrop" type="button" data-cart-close aria-label="Savatchani yopish" tabindex="-1"></button>
    <aside class="cart-drawer" id="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1">
      <header class="cart-header"><div>${icon("shopping-bag")}<h2 id="cart-title">Savatcha</h2><span class="cart-count">0</span></div><button class="cart-close icon-button" type="button" data-cart-close aria-label="Savatchani yopish" title="Yopish">${icon("x")}</button></header>
      <div class="cart-content">
        <div class="cart-empty" id="cart-empty">${icon("shopping-bag")}<h3>Savatchangiz hozircha bo‘sh</h3><p>Yoqtirgan mahsulotlaringiz shu yerda jamlanadi.</p><button class="text-button" type="button" data-cart-close data-scroll-to-shop>Xaridni boshlash ${icon("arrow-right")}</button></div>
        <div class="cart-items" id="cart-items" aria-live="polite"></div>
      </div>
      <footer class="cart-footer">
        <div class="cart-total"><span>Jami</span><strong id="cart-total">0 so‘m</strong></div>
        <form class="checkout-form" id="checkout-form" novalidate>
          <div class="checkout-fields" hidden>
            <label><span>Ismingiz</span><input type="text" name="name" autocomplete="name" minlength="2" maxlength="60" placeholder="Ismingizni kiriting" required /></label>
            <label><span>Telefon raqamingiz</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" minlength="9" maxlength="24" placeholder="+998 90 123 45 67" required /></label>
          </div>
          <label class="checkout-honeypot" aria-hidden="true">Sayt<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
          <button class="checkout-button" id="checkout-button" type="submit" disabled><span>Buyurtmani yuborish</span>${icon("arrow-right")}</button>
          <p class="checkout-note">Buyurtmani tasdiqlash uchun siz bilan bog‘lanamiz.</p>
          <p class="checkout-status" id="checkout-status" role="status" aria-live="polite"></p>
        </form>
      </footer>
    </aside>
  </div>
  <p class="storefront-toast" id="storefront-toast" role="status" aria-live="polite"></p>
`);

const desktopCartSlot = document.querySelector("#desktop-cart-slot");
if (desktopCartSlot) desktopCartSlot.append(document.querySelector("#cart-layer"));
