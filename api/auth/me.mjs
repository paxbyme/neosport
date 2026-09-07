import { readSession } from "../../auth-session.mjs";
import { isAuthConfigured } from "../../auth-service.mjs";
import { isTelegramAuthConfigured } from "../../telegram-auth.mjs";

export default function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  const session = readSession(request);
  response.statusCode = 200;
  response.end(
    JSON.stringify({
      ok: true,
      // The pages only show a button for a method that is actually configured.
      googleEnabled: isAuthConfigured(),
      telegramEnabled: isTelegramAuthConfigured(),
      user: session && {
        email: session.email,
        phone: session.phone,
        name: session.name,
        picture: session.picture,
        role: session.role,
      },
    }),
  );
}
