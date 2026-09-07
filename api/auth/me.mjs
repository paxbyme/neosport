import { readSession } from "../../auth-session.mjs";
import { isAuthConfigured } from "../../auth-service.mjs";

export default function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  const session = readSession(request);
  response.statusCode = 200;
  response.end(
    JSON.stringify({
      ok: true,
      // The page needs to know whether to show the button at all.
      googleEnabled: isAuthConfigured(),
      user: session && { email: session.email, name: session.name, picture: session.picture, role: session.role },
    }),
  );
}
