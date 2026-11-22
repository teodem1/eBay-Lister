# CLAUDE.md

@AGENTS.md

Guidance for Claude Code when working in this repository.

## Project

eBay-Lister — a tool for creating and managing eBay listings. The codebase is
just getting started; update this file as the structure grows.

## Commands

Stack: Next.js + TypeScript web UI (mobile-friendly). eBay API calls go
through server-side API routes so the client secret never reaches the browser.

- Install: `npm install`
- Dev:     `npm run dev` (http://localhost:3000)
- Test:    `npm test` (Vitest)
- Lint:    `npm run lint`
- Build:   `npm run build`
- APK (Capacitor): `CAP_SERVER_URL=https://<host> npm run cap:sync`, then
  `npm run cap:open` (Android Studio) or `npm run android:apk`. CI builds a
  debug APK in `.github/workflows/android-apk.yml`. See `docs/android.md`.

The Android app is a Capacitor shell that loads the hosted Next.js server
(`server.url`), so nothing secret is bundled. Screens use the camera and
barcode scanner only through `src/lib/native/` (native in the APK, browser
fallback on the web).

Copy `.env.example` to `.env` and fill in your eBay keys (use `EBAY_ENV=sandbox`
while developing).

## Structure

Screens (phone first):
- `/` — `src/components/ItemLookup.tsx`: photo, barcode scan, eBay matches. "Create listing"
  hands the identified item to the listing screen.
- `/listing` — `src/app/listing/ListingEditor.tsx`: Claude-written listing, review, publish.
  Accepts `?q=&barcode=&price=` so earlier steps can prefill it.
  On load it calls `/api/price-suggestion` and shows two prices in `PriceSuggestionPanel.tsx`:
  last sold (Marketplace Insights if eBay approves, else sold-comps.com via
  `src/lib/ebay/soldComps.ts` when `SOLD_COMPS_API_KEY` is set) and current listings (Browse). It
  prefills last-sold recommended, else current; a `?price=` or a price the user picks wins.

Server code:
- `src/lib/ebay/client.ts` — app-token client (Browse search) used by lookup and pricing.
- `src/lib/ebay/comparables.ts` — Marketplace Insights sold search with Browse fallback.
- `src/lib/pricing/` — price suggestion from comparables; served by `src/app/api/price-suggestion/route.ts`. See `docs/sold-price-data.md`.
- `src/lib/ebay/sell.ts` — user-token client (OAuth, Inventory API, Taxonomy). `fetch` is injectable for tests.
- `src/lib/ebay/publish.ts` — publish flow: location → inventory item → offer (create or update) → publish.
  Ported from `ebay_handler.py` in teodem1/ebay-item-listings-anthropic-claude.
- `src/lib/ebay/config.ts` — env settings for both clients.
- `src/lib/identify/` — Claude vision photo identification, barcode helpers.
- `src/lib/listing/generate.ts` — Claude writes the SEO title, item specifics and HTML description.
- `src/app/api/lookup/{barcode,photo}`, `src/app/api/price-suggestion` and `src/app/api/listing/{generate,publish}` — server routes.

Env: see `.env.example`. Camera access on a phone needs HTTPS (localhost is fine).

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.
