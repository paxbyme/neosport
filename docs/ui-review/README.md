# NeoSport storefront and admin review

Local preview: [homepage](http://localhost:4173/), [shop](http://localhost:4173/shop), [admin](http://localhost:4173/admin).

[Open the screenshot review](http://localhost:4173/docs/ui-review/index.html). It includes all five requested widths: **360, 390, 768, 1024 and 1440px**. Admin remains protected by the existing configured authentication.

## Delivered

- Homepage: full-width original photography, prominent NEOSPORT identity and supporting brand copy, shared API-backed product cards and shopping dialogs, original collections, Namangan map and Instagram destinations. Mobile composition separates the main copy from the photograph's model, and the next section starts in the first viewport. Removed the duplicate fixed mobile action bar and unsupported response/restock promises.
- Shop: retained and verified the existing compact sidebar/catalog/cart implementation, square contained photography, live search, actual category/size filters, all four sorts, variant dialog, saved cart, customer details and order flow. Improved touch targets and honest empty-state copy.
- Admin: replaced the oversized introduction and combined layout with five separate pages, one per task: `/admin` (Statistika), `/admin/categories`, `/admin/products`, `/admin/product` (add, or edit via `?id=`) and `/admin/customers`. Shared chrome, the authentication gate and the browser helpers live in `admin-shell.js`; each page loads only its own module and only the requests that task needs. Added actual-data catalog filters, status switches, labeled icon actions, grouped fields, responsive navigation, unsaved-edit confirmation, upload feedback and visible operation errors/retry. Preserved category renaming/order/usage safeguards, category-dependent sizes, ten-image galleries, primary images, existing discounts and authentication.
- No new production dependencies. Existing palette, fonts, assets, routes, cart storage, Google/password behavior and Telegram order integration remain in place. Telegram authentication now shares one accessible dialog across all three pages; its optional JSON start response and cancellation endpoint extend the existing API.

## Verification

- `npm test`: production build and **68 passing tests**, including authorization, order total validation, category safeguards, discounts and image processing with isolated service fixtures.
- `tests/storefront.browser.mjs`: homepage/shop at all five widths; real public catalog data, square images, two/three/single-column breakpoints, search by name/brand, category and size filters, reset, all four sorts, required selections, gallery, quantities, cart persistence/removal, keyboard trapping/restoration, authentication destinations, external links and section anchors.
- Additional storefront cases: loading, empty, no results, retry after failure without losing the cart, long cart, short viewport inputs, resize between drawer and adjacent cart, 320px fallback, and an intercepted nine-product catalog.
- `tests/admin.browser.mjs`: five pages at every requested width, asserting each navigation loads a fresh document, requests only its own dependencies and keeps one `/api/auth/me` check; product create/edit/status/delete, category create/rename/status/order/delete and used-category safeguards, discount preview, clothing/footwear sizes, image URLs/primary/removal, required fields, failed save/retry, unsaved drafts and accessible navigation. **60 intercepted management writes** across the five-width workflow matrix.
- Additional admin cases: 6 MB upload limit, invalid file type, ten-image boundary, draft discard/cancel, session expiry, unauthorized visitors, non-admin accounts, configured password login/logout, unavailable catalog/categories/statistics, empty data and retries.
- Browser checks assert accessible control names, minimum 44px targets, no nested controls and no horizontal page overflow. Wide admin tables scroll inside labeled containers. Reduced-motion emulation is used for the captures; CSS transitions use 180ms for the new surfaces.
- Telegram: 15 page/viewport combinations cover the homepage, shop and admin at all five widths. Checks include blocked popups, visible keyboard focus, focus trapping/restoration, 44px targets, Escape cancellation, transient errors with automatic retry, expired links/restart, successful redirects, checkout prefill, and admin access. Additional cases cover an intercepted popup, 600px viewport height, reload/resume, start/cancel errors, cancellation races, and customer access denial. Server tests cover private chats, contact ownership, signed browser proof, expiry, atomic consumption, account binding, logout, rate limits, diagnostics and webhook failures.
- Local preview security: private environment files, Git metadata, backend modules, customer data and traversal paths are blocked; public routes, assets and review files remain accessible. Verified with a unit test and HTTP requests.
- Machine-readable records: [Telegram results](telegram-results.json), [storefront results](results.json), [admin results](admin-results.json).

**All browser order submissions and management API requests are intercepted. No test order was sent to Telegram and no test changed the live catalog.** Storefront screenshots show the two real products returned by the public catalog during review. Admin screenshots use isolated fixtures, including synthetic orders and a test category; their statistics are not live business figures. Test code, fixtures and this review directory are excluded from the explicit production build.

## Reproduce

Start `npm run dev`. Browser tooling is optional and stays outside production dependencies:

```sh
PLAYWRIGHT_MODULE=/tmp/neosport-ui-tools/node_modules/playwright/index.mjs \
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node tests/storefront.browser.mjs

PLAYWRIGHT_MODULE=/tmp/neosport-ui-tools/node_modules/playwright/index.mjs \
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node tests/admin.browser.mjs

PLAYWRIGHT_MODULE=/tmp/neosport-ui-tools/node_modules/playwright/index.mjs \
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node tests/telegram.browser.mjs
```

Alternatively install Playwright separately and use its module/browser paths. `STOREFRONT_URL` defaults to `http://localhost:4173`. Screenshots are regenerated under this directory and are ignored by Git.

## Remaining limits

- The [Shopnetic reference page](https://dribbble.com/shots/26274702-Shopnetic-Point-Of-Sales-Dashboard) was readable, but the artwork did not load. Composition follows the sidebar/catalog/cart dimensions and organization in the brief; its colors were not adopted.
- The current product API has no variant-level stock counts or compatibility matrix. The UI preserves its available choices and existing quantity limits without inventing stock or combinations.
- Google/Telegram destinations, password headers, server authentication and intercepted order flows were tested. Completing external social sign-in, real Telegram delivery and production catalog writes were not performed. The supplied bot token and verified `SITE_URL=https://neosport-nu.vercel.app` are configured locally. The deployed webhook secret was checked using an empty update (authenticated HTTP 200, unauthenticated HTTP 401). Registered `@neosport_authbot` at `https://neosport-nu.vercel.app/api/telegram/webhook`, preserving pending updates. Real contact sharing and complete sign-in still require the account owner. The check command validates configuration without changing external state. Setup steps are in the root README.
- Browser verification uses desktop Chromium emulation. Physical iOS/Android keyboards, safe-area behavior and other browser engines still need device checks.
- Remote fonts and product photography still rely on their existing providers. The storefront retains its image-error fallback.
- Admin screenshots predate the split into separate pages and the Mijozlar view; Playwright was not installed in the sessions that made those changes, so `admin-fixture-*.png` has not been regenerated. The routing was verified against the running server (all five URLs, their modules and the production build), and `npm test` covers the page/route/build/allowlist wiring. Re-run the admin browser check to refresh the captures.
- Changes are local and have not been deployed.
