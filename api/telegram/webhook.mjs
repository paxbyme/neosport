import { AuthError } from "../../auth-session.mjs";
import {
  attachChatToToken,
  callTelegram,
  findPendingToken,
  findPendingTokenForChat,
  markTokenVerified,
  verifyWebhookSecret,
} from "../../telegram-auth.mjs";
import { registerTelegramUser } from "../../user-service.mjs";

const SITE_NAME = "NeoSport";

const siteUrl = (environment = process.env) =>
  String(environment.SITE_URL || "https://neosport-nu.vercel.app").replace(/\/$/, "");

const reply = (chatId, text, extra = {}) =>
  callTelegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });

const askForContact = (chatId) =>
  reply(
    chatId,
    `<b>${SITE_NAME}ga kirish</b>\n\nDavom etish uchun telefon raqamingizni ulashing. Raqam sizni tanish va buyurtmalaringizni bog‘lash uchun ishlatiladi.`,
    {
      reply_markup: {
        keyboard: [[{ text: "📱 Telefon raqamni ulashish", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );

export default async function handler(request, response) {
  // Telegram retries on any non-2xx, so this endpoint answers 200 for every
  // update it understands and only refuses a request with a bad secret.
  const done = (status = 200) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: status === 200 }));
  };

  try {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return done(405);
    }
    verifyWebhookSecret(request);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error("Telegram webhook rejected", error);
    return done(status);
  }

  try {
    const message = request.body?.message;
    const chatId = message?.chat?.id;
    if (!chatId) return done();

    // Step one: the deep link arrives as "/start <token>". The chat is written
    // onto the token row, because the contact below lands in a separate
    // webhook call that may run on a different instance.
    const startToken = String(message.text || "").match(/^\/start\s+([A-Za-z0-9_-]{10,80})$/)?.[1];
    if (startToken) {
      if (!(await findPendingToken(startToken))) {
        await reply(chatId, "Bu kirish havolasi eskirgan. Saytga qaytib, qaytadan urinib ko‘ring.");
        return done();
      }
      await attachChatToToken(startToken, chatId);
      await askForContact(chatId);
      return done();
    }

    if (String(message.text || "").startsWith("/start")) {
      await reply(chatId, `Salom! ${SITE_NAME}ga kirish uchun saytdagi «Telegram orqali kirish» tugmasini bosing.`);
      return done();
    }

    // Step two: the shared contact completes the token this chat is waiting on.
    const contact = message.contact;
    if (contact) {
      // Sharing somebody else's contact card must not sign you in as them.
      if (String(contact.user_id || "") !== String(message.from?.id || "")) {
        await reply(chatId, "Iltimos, o‘zingizning raqamingizni ulashing.");
        return done();
      }

      const pending = await findPendingTokenForChat(chatId);
      if (!pending) {
        await reply(chatId, "Kirish so‘rovi topilmadi yoki muddati tugagan. Saytga qaytib, qaytadan boshlang.");
        return done();
      }

      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
      await markTokenVerified(pending.token, { chatId, phone: contact.phone_number, name });

      // The contact is the sign-up: this is the first moment the number is
      // proven, so the customer record is written here rather than when the
      // browser comes back for its session. A failure to record it must not
      // cost the customer their sign-in — the session cookie stands alone.
      let registration = null;
      try {
        registration = await registerTelegramUser({ chatId, phone: contact.phone_number, name });
      } catch (error) {
        console.error("Telegram customer could not be registered", chatId, error.message);
      }

      const greeting = registration?.isNew
        ? `✅ Ro‘yxatdan o‘tdingiz${name ? `, ${name}` : ""}!`
        : `✅ Tasdiqlandi. Xush kelibsiz${name ? `, ${name}` : ""}!`;

      await reply(chatId, `${greeting} Saytga qayting — kirish avtomatik yakunlanadi.\n\n${siteUrl()}`, {
        reply_markup: { remove_keyboard: true },
      });
      return done();
    }

    return done();
  } catch (error) {
    // Still 200: retrying would replay the same failing update forever.
    console.error("Telegram webhook failed", error);
    return done();
  }
}
