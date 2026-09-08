# NeoSport Storefront Redesign

Local preview: [shop](http://localhost:4173/shop) and [homepage](http://localhost:4173/).

The shop now uses a compact sidebar, a searchable catalog and an adjacent sticky cart at 1200px and wider. Three catalog columns start at 1440px; smaller desktop and tablet views use two. Below 768px, navigation and size filtering move into a menu drawer. The cart becomes a sheet, and the product dialog stacks vertically with a sticky purchase action. Below 360px, cards use a single column.

NeoSport's existing colors, fonts, photography, logo, routes, API endpoints, authentication and Telegram order integration remain in use. The homepage now renders the same real product cards and shopping dialogs. Its hero, collections, brand information, location and contact destinations remain available.

## Screenshots

Screenshots are written next to this file by the browser test and are not
committed; run the test below to regenerate them. It captures the shop, the
shop with an open cart, product selection and the homepage at 390px and
1440px, plus full-page shop and homepage captures at 360, 390, 768, 1024 and
1440px. The recorded run showed the two real catalog products available on
September 8, 2026. No preview products were saved to the catalog.

## Verification

- `npm test`: production build and 52 smoke tests.
- `tests/storefront.browser.mjs`: browser checks across all five requested widths. Results are recorded in `results.json`.
- Checks cover search by name/brand, category and size filters, reset, price sorting, gallery changes, required sizes, cart quantities and persistence, removal, dialog closing, focus restoration, menu focus, authentication destinations, homepage shopping and horizontal overflow.
- Checkout validation, error and success are tested with intercepted browser responses. No real order is submitted.
- Additional cases cover loading, empty and failed catalogs, retry without losing the saved cart, long cart scrolling, resizing an open cart, short viewport input focus, a 320px screen, and a nine-product grid constructed only inside an intercepted test response.

The browser test needs Playwright and Chromium, separate from production dependencies. Start the existing server with `npm run dev`, then run `node tests/storefront.browser.mjs`. For an external Playwright installation, set `PLAYWRIGHT_MODULE` to its module path and optionally `CHROMIUM_PATH` to the browser executable. `STOREFRONT_URL` defaults to `http://localhost:4173`. The current review tools are installed under `/tmp/neosport-ui-tools`.

## Limits

- The existing API supplies available sizes/colors and product activation, but no variant-level inventory counts or unavailable combinations. The UI offers the available choices and preserves the existing ten-item quantity limit. It does not invent sold-out options or stock counts.
- Google and Telegram entry-point destinations are verified. Completing an external sign-in and sending a real Telegram order are intentionally outside browser testing.
- The Dribbble reference page was readable, but its artwork did not load in the browser. Composition follows the detailed sidebar, catalog and cart proportions supplied in the request.
- Verification uses Chromium emulation, including reduced motion. Physical iOS/Android keyboard and browser behavior still merit a device check.
- Changes are local; the existing production deployment has not been replaced.

Lucide icons are shipped as a small local SVG sprite with their license. No production package dependencies were added.
