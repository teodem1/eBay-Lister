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
- `/` — `src/components/ItemLookup.tsx`: photo or barcode scan, then the album and the seller's disc and
  inlay grades (`ConditionPicker compact`). "Create listing" hands both to the listing screen
  (`?disc=&inlay=&sealed=`, `conditionParams`), whose price check then keeps only copies in that condition
  (`sameCondition`). No eBay matches are listed here; they show on the price step.
  In the APK the buttons use the native camera and ML Kit scanner via `src/lib/native/`;
  in a browser, barcode scan uses the live scanner in `BarcodeScanner.tsx`.
- `/listing` — `src/app/listing/ListingEditor.tsx`: Claude-written listing, review, publish.
  Accepts `?q=&barcode=&price=` so earlier steps can prefill it.
  Before Claude writes, the seller grades the disc and the inlay separately in `ConditionPicker.tsx`
  (plus sealed, case, tested, defects; `src/lib/listing/condition.ts`). The eBay condition follows from the
  weaker of disc and inlay (`ebayConditionFromGrades`). It sets the
  draft's condition and condition text; Claude never guesses them. Claude writes the listing automatically once the CD is graded
  and the price check is back ("Write it again" rewrites it). The title ends with the seller's
  grades in the seller's template (`cdTitle`, e.g. "Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)"). Photos come from the camera or
  gallery in `PhotoPicker.tsx`, centre-cropped to a 1600px square like a CD (`resizeImage` `square`); "Take photo" opens `CdCamera.tsx`, a live
  camera on the main 1x back lens (`openMainBackCamera`) with a square CD guide (falls back to the phone camera), and they upload to eBay Picture Services through `/api/listing/photo`
  (`EbaySellClient.uploadImage`, Media API on apim.ebay.com).
  On load it calls `/api/price-suggestion` and shows two prices in `PriceSuggestionPanel.tsx`:
  last sold (Marketplace Insights if eBay approves, else sold-comps.com via
  `src/lib/ebay/soldComps.ts` when `SOLD_COMPS_API_KEY` is set) and current listings (Browse). It
  prefills last-sold recommended, else current; a `?price=` or a price the user picks wins.
  Prices use only Canadian copies (sold from CA or titled Canadian) when there are 3+, and leave out
  other versions the item text doesn't name (Japanese, vinyl, signed, lots): `src/lib/pricing/version.ts`.
  Tapping a sale or listing (thumbnail or title) opens `ComparableSheet.tsx`: photos, description, CD and inlay
  condition, country of origin and "Open on eBay", read from Browse getItem through `/api/comparable`
  (`src/lib/ebay/itemDetails.ts`; ended sales fall back to what the title says). Only CDs are searched and shown
  (`cdKeywords`, `onlyCds`) unless the item text names another format; the notes box is not shown.
  With a barcode, sold (sold-comps keyword = bare 12-digit UPC) and current (Browse `gtin`)
  searches return that exact pressing; only with fewer than 3 matches do they search by name (a second
  sold-comps call). Barcode matches skip the Canadian-copies filter.

  After a successful publish (the green "Published" notice shows for 1.5 s) the app reloads `/` fresh for the next CD.

- `/collection` — `src/app/collection/CollectionScreen.tsx`: a CD is saved here from the listing
  screen (`src/app/listing/SaveToCollection.tsx`: "Add to Collection", or automatically on publish),
  using the reviewed item specifics and price plus the cover the scan found (handed over in
  sessionStorage by `stashScanned`). Each CD shows cover, album, artist, year, CAD price and user
  categories, with search, category filter, sort, total inventory value and a JSON backup. Logic in `src/lib/collection/collection.ts`,
  storage in `src/lib/collection/store.ts` (localStorage on the device, no server DB). Album
  details come from MusicBrainz + Cover Art Archive (`src/lib/music/musicbrainz.ts`, no key),
  added to lookup responses as `album`. When MusicBrainz misses a barcode, Claude Haiku reads artist and album
  off the eBay titles (`src/lib/music/albumFromTitles.ts`). `TabBar` in `ui.tsx` switches Scan / Collection.

Look and feel: design tokens (light + dark) and component classes (`.page`, `.card`, `.field`,
`.btn btn-primary`, `.notice`, `.skeleton`...) live in `src/app/globals.css`; shared pieces
(`AppBar`, `Spinner`, `StepHeading`, `Logo`, `Icon`, `TabBar`) in `src/components/ui.tsx`. Text uses the type
scale classes `.t-display/.t-title/.t-headline/.t-small/.t-caption` (12px floor, no ad hoc sizes). Selected
states use `.choice` / `.chip-toggle` with `aria-pressed` (tinted + outline + check), never the solid
primary colour, which is kept for the one main action. Icons come from `Icon` only. Design rationale and
before/after screenshots: `docs/redesign/`. Use the token colours
(`bg-surface`, `text-muted`, `border-line`, `bg-brand`...) rather than raw Tailwind palette colours.

Server code:
- `src/lib/ebay/client.ts` — app-token client (Browse search) used by lookup and pricing.
- `src/lib/ebay/comparables.ts` — Marketplace Insights sold search with Browse fallback.
- `src/lib/pricing/` — price suggestion from comparables; served by `src/app/api/price-suggestion/route.ts`. See `docs/sold-price-data.md`.
- `src/lib/ebay/sell.ts` — user-token client (OAuth, Inventory API, Taxonomy). `fetch` is injectable for tests.
- `src/lib/ebay/publish.ts` — publish flow: location → inventory item → offer (create or update) → publish.
  Ported from `ebay_handler.py` in teodem1/ebay-item-listings-anthropic-claude.
- `src/lib/ebay/oauth.ts` + `src/app/api/ebay/{connect,callback}` — one-time eBay sign-in that shows the refresh token for `EBAY_REFRESH_TOKEN` (needs `EBAY_RUNAME`).
- Promoted Listings: after publish, `/api/listing/publish` adds the listing to a cost-per-sale campaign at `EBAY_PROMOTED_PERCENT` (or the draft's `promotedPercent`) via `EbaySellClient.promoteListing` (needs the `sell.marketing` scope).
- `src/lib/ebay/config.ts` — env settings for both clients.
- `src/lib/identify/` — Claude vision photo identification, barcode helpers.
- `src/lib/listing/generate.ts` — Claude writes the SEO title, item specifics and HTML description.
  Package defaults to 65 g (`DEFAULT_PACKAGE_WEIGHT_KG`, edited in grams) and 12 × 15 × 1 cm (`DEFAULT_PACKAGE_CM`, a CD mailer).
  The description says the seller ships only to Canada and the US. On the review step it is edited as plain text
  (`DescriptionEditor.tsx`, `src/lib/listing/descriptionText.ts`: "## " heading, "- " bullet, **bold**) with a Preview tab.
  Publish leaves Brand and MPN empty for CDs/music (`isMusicDraft`, `withoutBrandAndMpn`); other items get them filled
  (`withBrandAndMpn`). On eBay error 25002 (BrandMPN) it re-sends the item the other way once and publishes again.
- `src/app/api/lookup/{barcode,photo}`, `src/app/api/price-suggestion` and `src/app/api/listing/{generate,publish}` — server routes.

Env: see `.env.example`. Camera access on a phone needs HTTPS (localhost is fine).

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.
