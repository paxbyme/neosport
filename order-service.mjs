import { randomBytes } from "node:crypto";
import { saveOrder } from "./order-store.mjs";
import { listProducts } from "./product-service.mjs";
import { checkRateLimit } from "./rate-limit.mjs";

export class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const enforceOrderRateLimit = (address = "unknown") => {
  if (!checkRateLimit("order", address, { max: 5, windowMs: 10 * 60 * 1000 })) {
    throw new OrderError("Juda ko‘p urinish bo‘ldi. 10 daqiqadan keyin qayta urinib ko‘ring.", 429);
  }
};

const escapeTelegramHtml = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const formatMoney = (amount) => `${new Intl.NumberFormat("uz-UZ").format(amount)} so‘m`;

// Stored digits-only, shown the way the number is written: +998 90 123 45 67.
const formatPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return /^998\d{9}$/.test(digits)
    ? `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`
    : `+${digits}`;
};

const validateCustomer = (payload) => {
  if (String(payload?.website || "").trim()) throw new OrderError("Buyurtma qabul qilinmadi.");

  const name = String(payload?.name || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new OrderError("Ismingizni to‘g‘ri kiriting.");

  const phone = String(payload?.phone || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 9 || phoneDigits.length > 15 || !/^\+?[\d\s()\-]{9,24}$/.test(phone)) {
    throw new OrderError("Telefon raqamingizni to‘g‘ri kiriting.");
  }

  return { name, phone };
};

const validateItems = async (items, environment) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    throw new OrderError("Savatchadagi mahsulotlarni tekshiring.");
  }

  const products = await listProducts(environment);
  const catalogue = new Map(products.filter((product) => product.active).map((product) => [product.id, product]));

  return items.map((item) => {
    const product = catalogue.get(String(item?.productId || ""));
    const quantity = Number(item?.quantity);
    const color = product?.colors.find((candidate) => candidate.id === item?.color);
    const size = String(item?.size || "");

    if (!product || !color || !product.sizes.includes(size) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new OrderError("Savatchada noto‘g‘ri mahsulot ma’lumoti bor.");
    }

    const unitPrice = product.finalPrice ?? product.price;
    return { product, color, size, quantity, unitPrice, subtotal: unitPrice * quantity };
  });
};

const buildTelegramMessage = ({ orderId, customer, items, total, createdAt, account }) => {
  const itemLines = items
    .map(
      (item, index) =>
        `<b>${index + 1}. ${escapeTelegramHtml(item.product.name)}</b>\n` +
        `   Rang: ${escapeTelegramHtml(item.color.label)}\n` +
        `   O‘lcham: ${escapeTelegramHtml(item.size)}\n` +
        `   Soni: ${item.quantity}\n` +
        (item.product.discountPercent > 0
          ? `   Narx: ${formatMoney(item.unitPrice)} (${item.product.discountPercent}% chegirma, avval ${formatMoney(item.product.price)})\n`
          : "") +
        `   Summa: ${formatMoney(item.subtotal)}`,
    )
    .join("\n\n");

  return (
    `🛍 <b>YANGI BUYURTMA</b>\n` +
    `Buyurtma: <code>${escapeTelegramHtml(orderId)}</code>\n\n` +
    `👤 <b>Mijoz:</b> ${escapeTelegramHtml(customer.name)}\n` +
    `📞 <b>Telefon:</b> ${escapeTelegramHtml(customer.phone)}\n` +
    (account ? `🔐 <b>Tasdiqlangan hisob:</b> ${escapeTelegramHtml(account)}\n` : "") +
    `\n` +
    `${itemLines}\n\n` +
    `💰 <b>Jami: ${formatMoney(total)}</b>\n` +
    `🕓 ${escapeTelegramHtml(createdAt)}`
  );
};

export const createTelegramOrder = async (payload, environment = process.env, user = null) => {
  const token = String(environment.TELEGRAM_BOT_TOKEN || "");
  const chatId = String(environment.TELEGRAM_CHAT_ID || "");
  if (!token || !chatId) throw new OrderError("Buyurtma xizmati hali sozlanmagan.", 503);

  const customer = validateCustomer(payload);
  const items = await validateItems(payload?.items, environment);
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const orderId = `NS-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const createdAt = new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date());
  // Google identifies an account by email, Telegram by a verified phone
  // number; the notification shows whichever one placed the order.
  const account = user?.email || (user?.phone ? formatPhone(user.phone) : "");
  const text = buildTelegramMessage({ orderId, customer, items, total, createdAt, account });

  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (environment.TELEGRAM_MESSAGE_THREAD_ID) body.message_thread_id = Number(environment.TELEGRAM_MESSAGE_THREAD_ID);

  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error("Telegram request failed", error.message);
    throw new OrderError("Telegram bilan bog‘lanib bo‘lmadi. Qayta urinib ko‘ring.", 502);
  }

  if (!response.ok) {
    const details = await response.text();
    console.error("Telegram rejected order", response.status, details.slice(0, 500));
    throw new OrderError("Buyurtmani Telegramga yuborib bo‘lmadi.", 502);
  }

  // Telegram is the fulfilment channel, so the order counts as placed once it
  // is delivered there. A storage failure must not lose the customer's order id.
  try {
    await saveOrder(
      {
        id: orderId,
        createdAt: new Date().toISOString(),
        customerName: customer.name,
        customerPhone: customer.phone,
        userId: user?.id || null,
        userEmail: user?.email || null,
        userPhone: user?.phone || null,
        items: items.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          brand: item.product.brand,
          category: item.product.category,
          color: item.color.label,
          size: item.size,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        })),
        total,
      },
      environment,
    );
  } catch (error) {
    console.error("Order was sent to Telegram but not stored", orderId, error.message);
  }

  return { orderId };
};
