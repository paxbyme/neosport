import assert from "node:assert/strict";
import test from "node:test";
import { isPublicPreviewPath } from "../preview-static.mjs";

test("the preview exposes browser assets and review artifacts while keeping secrets and customer data private", () => {
  for (const path of ["/", "/shop", "/admin", "/admin.html", "/telegram-login.js", "/telegram-login.css", "/assets/neosport-hero.webp", "/assets/uploads/product.webp", "/docs/ui-review/index.html"])
    assert.equal(isPublicPreviewPath(path), true, path);
  for (const path of ["/.env", "/.env.local", "/.git/config", "/data/orders.json", "/server.mjs", "/telegram-setup.mjs", "/node_modules/pg/package.json", "/assets/../.env.local", "/assets/.env", "/assets/../../data/orders.json", "/assets/..\\.env.local", "/docs/ui-review/../../../.env.local", "/assets/a\0b"])
    assert.equal(isPublicPreviewPath(path), false, path);
  for (const path of ["/%2eenv.local", "/assets/%2e%2e/%2eenv.local", "/assets/%5c..%5c.env.local"])
    assert.equal(isPublicPreviewPath(decodeURIComponent(new URL(path, "http://localhost").pathname)), false, path);
});
