# Architecture

OrderScraperExtension — chrome-extension (Manifest V3, vanilla JS, no build step)

## Layout
- `manifest.json` — V3 declaration: `activeTab` + `storage` permissions, service-worker background, 4 content scripts.
- `background.js` — service worker: message router (`openCoinsTab`, `openAmazonPayTab`, `closeTab`, `extractionComplete`) and scraping-tab lifecycle cleanup.
- `content.js` — Flipkart order history + Plus coins scraper (ISOLATED world, `document_idle`).
- `content-amazon.js` — Amazon order history scraper (ISOLATED world, `document_idle`).
- `content-amazon-pay.js` — Amazon Pay transaction history scraper (ISOLATED world, `document_idle`).
- `interceptor.js` — MAIN-world `fetch`/`XHR` hook for Amazon Pay history responses; re-emits payloads as a DOM `CustomEvent`.
- `popup.html` / `popup.js` — popup UI: scrape controls, history rendering, CSV/PDF export.
- `icon16.png` / `icon48.png` / `icon128.png`, `PRIVACY.md`.

## Data flow
1. `popup.js` sends `chrome.runtime.sendMessage` commands (`startScraping`, `stopScraping`, `resetState`, `checkStatus`, `openAmazonPayTab`, ...).
2. `background.js` opens scraping tabs with `active: true` (foreground is required; background tabs are throttled) and records `*ScrapingTabId`.
3. Content scripts read the page DOM, walk pagination/year filters, and write results to `chrome.storage.local`.
4. On Amazon Pay, `interceptor.js` (MAIN world) hooks `fetch`/`XHR`, matches `transactionDetails` / `transactionDetailPageURL`, and dispatches `CustomEvent("amazonPayDataIntercepted")`. `content-amazon-pay.js` (ISOLATED world) listens for that event — the only MAIN→ISOLATED bridge.
5. Content scripts signal `closeTab` / `extractionComplete`; the worker closes the tab or calls `chrome.action.openPopup()`.
6. `popup.js` reads `chrome.storage.local` to render results and export CSV/PDF.

## State (all in `chrome.storage.local`)
- Flipkart: `scraperStatus`, `orders`, `coinsHistory`, `coinsScrapingActive`, `coinsScrapingTabId`.
- Amazon: `amazonScraperStatus`, `amazonOrders`, `amazonTargetYears`, `amazonCurrentYearIndex`, `amazonPayHistory`, `amazonPayScrapingActive`, `amazonPayScrapingTabId`.
- Message actions: `startScraping`, `stopScraping`, `resetState`, `checkStatus`, `openCoinsTab`, `openAmazonPayTab`, `closeTab`, `extractionComplete`.

## Invariants
- MV3: no remote code, no inline script/handlers, no persistent service-worker state — everything lives in `chrome.storage.local`.
- Only content scripts touch page DOM. `interceptor.js` runs at `document_start` in the MAIN world and must not use `chrome.*` APIs; communicate via `CustomEvent` only.
- A `*ScrapingTabId` and its `*ScrapingActive` flag are cleared together (`background.js` → `chrome.tabs.onRemoved`), so a manually closed tab never leaves a stuck "active" state.
- Scraping always targets a foreground tab so lazy-loaded/paginated content renders.
- `manifest.json` `version` is the single release version; a `v*` tag must match it.

## Verification
- `vgate` must pass before reporting work as done.
- Manual equivalent: `chrome://extensions` → Load unpacked → reload → run Flipkart and Amazon scrapes, then export CSV/PDF.
- This surface has no build step (no bundler, no `package.json`); `manifest.json` and `popup.html` are shipped as-is.
- CI: `.github/workflows/ci.yml`.
