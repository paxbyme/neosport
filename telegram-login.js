// Shared Telegram sign-in for the storefront and the protected admin login.
// The session and browser-binding cookie remain HttpOnly on the server.
(() => {
  const storageKey = "neosport-telegram-attempt";
  const dialog = document.createElement("dialog");
  dialog.id = "telegram-auth-dialog";
  dialog.setAttribute("aria-labelledby", "telegram-auth-title");
  dialog.setAttribute("aria-describedby", "telegram-auth-description");
  dialog.innerHTML = `
    <button class="tg-close" type="button" aria-label="Kirishni bekor qilish" title="Bekor qilish">×</button>
    <img class="tg-mark" src="/assets/neosport-mark.webp" alt="NeoSport" width="44" height="50" />
    <p class="tg-eyebrow">NEOSPORT HISOBI</p>
    <h2 id="telegram-auth-title">Telegram orqali kirish</h2>
    <p id="telegram-auth-description">Telefon raqamingizni tasdiqlab, hisobingizga kiring.</p>
    <ol class="tg-steps"><li>Telegram botida <strong>Start</strong> tugmasini bosing.</li><li><strong>Telefon raqamni ulashish</strong> tugmasi orqali o‘z raqamingizni yuboring.</li><li>Kirishni boshlagan ushbu brauzer sahifasiga qayting.</li></ol>
    <p class="tg-status" id="telegram-auth-status" role="status" aria-live="polite"></p>
    <a class="tg-open" target="_blank" rel="noopener noreferrer" hidden>Telegramni ochish <span aria-hidden="true">↗</span></a>
    <button class="tg-check" type="button" hidden>Tasdiqni tekshirish</button>
    <button class="tg-retry" type="button" hidden>Qaytadan boshlash</button>
    <p class="tg-note">Tasdiqlangan raqam buyurtma ma’lumotlaringizni to‘ldirish uchun ishlatiladi.</p>`;
  document.body.append(dialog);
  const status = dialog.querySelector(".tg-status");
  const openLink = dialog.querySelector(".tg-open");
  const retryButton = dialog.querySelector(".tg-retry");
  const checkButton = dialog.querySelector(".tg-check");
  const closeButton = dialog.querySelector(".tg-close");
  let active = false, cancelling = false, timer = 0, generation = 0, deadline = 0, failures = 0;
  let startFlight = null, statusFlight = null;
  let next = location.pathname + location.search + location.hash;
  let startUrl = `/api/auth/telegram/start?next=${encodeURIComponent(next)}`;

  const stored = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { return null; } };
  const remember = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ next, deadline })); } catch {} };
  const forget = () => { try { sessionStorage.removeItem(storageKey); } catch {} };
  const safeNext = value => {
    try { const url = new URL(value || "/", location.origin); return url.origin === location.origin ? url.pathname + url.search + url.hash : "/"; }
    catch { return "/"; }
  };
  const request = async (url, options = {}) => {
    let response;
    try {
      response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000), ...options, headers: { Accept: "application/json", ...options.headers } });
    } catch { throw new Error("Ulanish uzildi. Internetni tekshirib, qayta urinib ko‘ring."); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Kirishni tekshirib bo‘lmadi. Qayta urinib ko‘ring.");
    return result;
  };
  const show = () => {
    if (!dialog.open) dialog.showModal();
    document.body.classList.add("telegram-auth-open");
  };
  const message = (text, state) => {
    status.textContent = text;
    dialog.dataset.state = state;
  };
  const stop = () => { clearTimeout(timer); timer = 0; };
  const schedule = () => {
    stop();
    if (active && !cancelling) timer = setTimeout(check, Math.min(10000, 2000 + failures * 2000));
  };
  const expired = () => {
    stop(); forget();
    message("Kirish havolasining muddati tugadi. Qaytadan boshlang.", "expired");
    openLink.hidden = true; checkButton.hidden = true; retryButton.hidden = false;
  };
  const complete = destination => {
    active = false; stop(); forget();
    message("Tasdiqlandi. Hisobingiz ochilmoqda…", "success");
    openLink.hidden = true; checkButton.hidden = true; retryButton.hidden = true;
    location.assign(safeNext(destination || next));
  };
  const check = async () => {
    if (!active || cancelling || startFlight || statusFlight) return;
    if (Date.now() >= deadline) { expired(); return; }
    const run = generation;
    checkButton.disabled = true;
    statusFlight = request("/api/auth/telegram/status");
    try {
      const result = await statusFlight;
      if (!active || cancelling || run !== generation) return;
      if (result.ready) { complete(result.next); return; }
      if (result.state === "used") {
        // A second tab may have consumed the attempt and installed the cookie.
        const auth = await request("/api/auth/me");
        if (!active || cancelling || run !== generation) return;
        if (auth.user) { complete(next); return; }
      }
      if (!result.waiting) { expired(); return; }
      if (Number.isFinite(result.expiresAt)) deadline = result.expiresAt;
      failures = 0;
      message("Telegram tasdig‘i kutilmoqda. Tasdiqlagach, ushbu sahifaga qayting.", "waiting");
      schedule();
    } catch (error) {
      if (!active || cancelling || run !== generation) return;
      failures += 1;
      message(`${error.message} Tekshirish avtomatik davom etadi.`, "error");
      schedule();
    } finally { statusFlight = null; checkButton.disabled = false; }
  };

  const begin = async (url = startUrl) => {
    if (startFlight || cancelling) return;
    const run = ++generation;
    active = true; stop(); failures = 0;
    startUrl = url;
    next = safeNext(new URL(url, location.origin).searchParams.get("next"));
    show();
    message("Telegram havolasi tayyorlanmoqda…", "preparing");
    openLink.hidden = true; retryButton.hidden = true; checkButton.hidden = true;
    // Open synchronously with the click. A visible link remains available when
    // the browser blocks popups or the user returns to a suspended mobile tab.
    let popup = null;
    try { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; } catch {}
    startFlight = request(startUrl);
    try {
      const result = await startFlight;
      if (!active || cancelling || run !== generation) { popup?.close(); return; }
      if (!/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Za-z0-9_-]{32}$/.test(result.url || "")) throw new Error("Telegram havolasini olib bo‘lmadi. Qayta urinib ko‘ring.");
      deadline = Date.now() + Math.min(600, Math.max(1, Number(result.expiresIn) || 600)) * 1000;
      remember();
      openLink.href = result.url; openLink.hidden = false; checkButton.hidden = false;
      message("Botda Start tugmasini bosing va telefon raqamingizni ulashing. Havola 10 daqiqa amal qiladi.", "waiting");
      if (popup && !popup.closed) { popup.location.replace(result.url); popup = null; }
      schedule();
    } catch (error) {
      popup?.close();
      if (!active || cancelling || run !== generation) return;
      message(error.message, "error"); retryButton.hidden = false;
    } finally { startFlight = null; }
  };

  const cancel = async () => {
    if (cancelling) return;
    const pendingStart = startFlight, pendingStatus = statusFlight;
    cancelling = true; generation += 1; stop();
    closeButton.disabled = true; checkButton.hidden = true; openLink.hidden = true; retryButton.hidden = true;
    message("Kirish bekor qilinmoqda…", "preparing");
    try {
      // Let a start response install its HttpOnly cookie before cancelling it.
      await pendingStart?.catch(() => {});
      const completed = await pendingStatus?.catch(() => null);
      // If the server has already issued the session, reflect that committed
      // result instead of silently closing on a stale signed-out page.
      if (completed?.ready) { complete(completed.next); return; }
      await request("/api/auth/telegram/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      active = false; forget(); document.body.classList.remove("telegram-auth-open"); dialog.close();
    } catch {
      message("Kirishni bekor qilib bo‘lmadi. Internetni tekshirib, yopish tugmasini qayta bosing.", "error");
    } finally { cancelling = false; closeButton.disabled = false; }
  };

  const resume = async () => {
    if (active || startFlight) return;
    const previous = stored();
    try {
      const result = await request("/api/auth/telegram/status");
      if (active || startFlight) return;
      if (result.ready) { complete(result.next); return; }
      if (!result.waiting) {
        if (previous && result.state === "expired") { active = true; show(); expired(); }
        else forget();
        return;
      }
      active = true;
      next = safeNext(previous?.next || next);
      startUrl = `/api/auth/telegram/start?next=${encodeURIComponent(next)}`;
      deadline = Number(result.expiresAt) || previous?.deadline || Date.now() + 600000;
      show(); remember();
      checkButton.hidden = false; retryButton.hidden = false;
      message("Telegram tasdig‘i kutilmoqda. Botda telefon raqamingizni ulashing va shu sahifaga qayting.", "waiting");
      schedule();
    } catch (error) {
      if (!previous || active) return;
      active = true; next = safeNext(previous.next); deadline = previous.deadline;
      show(); checkButton.hidden = false; retryButton.hidden = false;
      message(error.message, "error"); schedule();
    }
  };

  document.addEventListener("click", event => {
    const trigger = event.target.closest("[data-telegram-signin], #telegram-signin");
    if (!trigger || event.defaultPrevented) return;
    event.preventDefault();
    begin(trigger.getAttribute("href"));
  });
  retryButton.addEventListener("click", () => begin());
  checkButton.addEventListener("click", () => { stop(); check(); });
  closeButton.addEventListener("click", cancel);
  dialog.addEventListener("keydown", event => {
    // Keep the tab cycle in the dialog, including browsers that otherwise move
    // focus to their chrome after the last control. Underlying drawers stay idle.
    if (event.key === "Escape") event.stopPropagation();
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const controls = [...dialog.querySelectorAll("button:not(:disabled),a[href]")].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
  dialog.addEventListener("close", () => { if (!dialog.open) { document.body.classList.remove("telegram-auth-open"); stop(); } });
  const wake = () => { if (!document.hidden && active && !cancelling) { stop(); check(); } };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);
  window.NeoSportTelegram = { resume };
})();
