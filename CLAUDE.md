# CLAUDE.md

@AGENTS.md

Guidance for Claude Code when working in this repository.

## Current work

Stored SoldComps results and plugin-driven listing updates, on branch `comps-store`. Start at "Resume here" in
`docs/superpowers/plans/2026-11-27-comps-store.md`. No push, deployment, storage creation or eBay change without
the seller's approval; never ask for or print the access key or the SoldComps key.

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
  Grades picked on the scan screen show as a one-line summary with "Change" (no second picker).
  Otherwise, before Claude writes, the seller grades the disc and the inlay separately in `ConditionPicker.tsx`
  (plus sealed, case, tested, defects; `src/lib/listing/condition.ts`). The eBay condition follows from the
  weaker of disc and inlay (`ebayConditionFromGrades`). It sets the
  draft's condition and condition text; Claude never guesses them. A price check made before grading (Sort a pile, a
  scan with no grades; `PriceCheck.condition` unset) is narrowed on the phone to copies in that condition by
  `regradeCheck` (`src/lib/pricing/regrade.ts`), with no new lookup. With no barcode, the automatic write waits for two
  photos so Claude can check the back cover for a no-barcode pressing. Claude writes the listing automatically once the CD is graded
  and the price check is back ("Write it again" rewrites it). The title ends with the seller's
  grades in the seller's template (`cdTitle`, e.g. "Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)"). Photos (shown right under the Item step, so they can be shot
  while prices load and Claude writes) come from the camera or gallery in `PhotoPicker.tsx`, centre-cropped to a 1600px square like a CD (`resizeImage` `square`); "Take photo" opens `CdCamera.tsx`, a live
  camera on the main 1x back lens (`openMainBackCamera`) with a square CD guide (falls back to the phone camera), and they upload to eBay Picture Services through `/api/listing/photo`
  (`EbaySellClient.uploadImage`, Media API on apim.ebay.com).
  On load it calls `/api/price-suggestion` and shows two prices in `PriceSuggestionPanel.tsx`:
  last sold (Marketplace Insights if eBay approves, else sold-comps.com via
  `src/lib/ebay/soldComps.ts` when `SOLD_COMPS_API_KEY` is set) and current listings (Browse). It
  prefills last-sold recommended, else current; a `?price=` or a price the user picks wins.
  Searches by name use the short search name (`searchName` in `src/lib/pricing/version.ts`, via `cdKeywords`): no
  "Various Artists" prefix, bracketed parts or subtitle after a colon. Every sold lookup is saved to private Vercel Blob
  (`src/lib/comps/`, keyed by barcode, else the short name) for the plugin, which reads `/api/comps` before buying one.
  Prices use only Canadian copies (sold from CA or titled Canadian) when there are 3+, and leave out
  other versions the item text doesn't name (Japanese, vinyl, signed, lots): `src/lib/pricing/version.ts`.
  Tapping a sale or listing (thumbnail or title) opens `ComparableSheet.tsx`: photos, description, CD and inlay
  condition, country of origin and "Open on eBay", read from Browse getItem through `/api/comparable`
  (`src/lib/ebay/itemDetails.ts`; ended sales fall back to what the title says). Only CDs are searched and shown
  (`cdKeywords`, `onlyCds`) unless the item text names another format; the notes box is not shown.
  With a barcode, sold (sold-comps keyword = bare 12-digit UPC) and current (Browse `gtin`)
  searches return that exact pressing; only with fewer than 3 matches do they search by name (a second
  sold-comps call). When the only name is the barcode itself (eBay and MusicBrainz didn't know it), no name
  search runs (`hasName` in `comparables.ts`). Format words that are often album words ("Record", "Tapes", "Made in
  Japan") don't count as the seller asking for vinyl, tapes or Japanese copies, and the item name's own words are
  ignored in comparable titles (`otherVersion`, `namesOtherFormat`). Barcode matches skip the Canadian-copies filter.

  After a successful publish (the green "Published" notice shows for 1.5 s) the app reloads `/` fresh for the next CD.

- `/to-list` — `src/app/to-list/ToListScreen.tsx` ("To list" tab): CDs scanned but not listed yet, saved on the
  phone (`src/lib/batch/queue.ts` logic, `src/lib/batch/store.ts` localStorage). "Scan a stack" keeps the scanner
  open (`BarcodeScanner continuous`; in the APK the ML Kit scanner reopens after each CD) and album names load in the
  background two at a time (`/api/lookup/barcode`, no sold-comps calls). A CD started on the Scan screen joins the
  list too (`batchStore.fromScan`). Opening one goes to `/listing?...&batch=<id>` (`ResumeListing.tsx`), which saves
  grades, photos, the price check and Claude's draft on the entry as the seller goes and restores them on return
  (a saved price check is reused, so it costs one sold-comps call per CD). Publishing marks it listed; a CD from a
  scanned stack then opens the next one (`/to-list?next=1`).
- `/sort` — `src/app/sort/SortScreen.tsx` ("Sort a pile", linked from Scan and To list): one photo of several CDs side by
  side (spines or covers). `/api/lookup/shelf` (`src/lib/identify/shelf.ts`, Claude vision, no eBay or sold-comps calls)
  names each CD; the seller unticks or fixes names, sees how many sold-comps lookups pricing will use (at most
  `MAX_PRICE_PER_RUN` = 12 per run; checks cached 30 days on the phone in `src/lib/sort/store.ts`, and checks already saved
  on To list / Auto CDs are reused for free, `savedCheckFor` in `src/lib/pricing/savedCheck.ts`), then each CD gets exactly one
  `/api/price-suggestion` call by name (no barcode, so it never makes a second call; the 12 paid lookups are enforced in
  `runPricing`). A check that came back without sold prices (`soldLimitReached`) is never cached or carried to To list. CDs are ranked by
  net after fees (`netAfterFees` in `src/lib/sort/worth.ts`: 14.95% eBay.ca Music fee + 11% promoted on price + $7.99
  shipping, order fee, $1 mailer) against a $3 / $5 / $10 bar. "Add N worth selling to To list" makes To list entries
  (`itemFromSort`) carrying the price check (`BatchItem.priceCheck`), which the listing screen reuses (`initial.priceCheck`).
- Stack scans (To list and Auto) use `src/components/StackScan.tsx`: one barcode at a time, then a card with the CD found,
  "Next CD", "Try again" (rescans; a CD with photos or grades keeps them and just takes the new barcode, same entry so
  uploads in flight land on it, `retryScan`/`withNewBarcode` in `src/lib/batch/queue.ts`; closing the scanner keeps the first scan) and "Done scanning".
- `/auto` — `src/app/auto/AutoScreen.tsx` ("Auto" tab, listing with no review screen; the other tabs are unchanged):
  after each barcode the camera asks for the front cover, then the back cover (`AutoCdSteps.tsx`, `CdCamera prompt`),
  then extra photos (disc, spine, defects; up to `AUTO_MAX_PHOTOS` = 12), then the disc/inlay grade. Listing runs in the
  background: `useAutoRun.ts` starts each complete CD as soon as the seller moves on (CDs on the scan card or opened in the
  list are `held`), two CDs at a time, with a Pause / Resume bar: one price check (saved on the CD
  so a retry never spends a second sold-comps call; no sold or listed copies = not listed) → `/api/listing/generate`
  with `priceEvidence` (the comps as text), so Claude writes the listing AND picks the price (`claudePrice`), kept inside
  `priceBounds` (85% of quick sale to 115% of high) by `finalAutoPrice`. CDs priced at `COLLECTIBLE_MIN_CAD` ($25) or
  more, or with no eBay copies, also get the Discogs price guide (`/api/price-reference`, `src/lib/pricing/discogs.ts`,
  `DISCOGS_TOKEN`): its price for the CD's grade (`priceGrade`, worse of disc/inlay) goes into Claude's evidence and
  widens the range (or sets it when eBay found nothing) → `/api/listing/publish` (server defaults for
  shipping, Best Offer, promotion) → Collection. Its list is a second batch store (`autoStore`, key
  `ebay-lister:auto:v1`, `createBatchStore` in `src/lib/batch/store.ts`); logic in `src/lib/auto/auto.ts`. A failed CD
  shows "Try again" or "List by hand" (moves it to To list with grades, photos and price check).
  "Try again" on a CD that failed before Claude wrote it (nothing found to price) reopens the barcode scanner
  (`retryByRescan`, `rescanned`: photos and grades kept, album looked up again, the saved price check kept only for the
  same barcode); otherwise it reruns the CD. A retry always shows its spinner, and a repeat of the same failure says so
  (`tries`, `sameAgain`). When the barcode
  named no album (eBay and MusicBrainz miss), the run first has Claude read the front cover photo (`/api/lookup/cover`,
  `identifyFromImageUrl`; `needsCoverName`/`applyCoverName`, once per CD) and drops a price check made from the bare
  barcode so it searches by name. The scan card (`StackScan`) warns when a barcode found nothing, so it can be rescanned.
- `/review` — `src/app/review/ReviewScreen.tsx` ("Review" tab): the Auto tab's published listings with photos, price and
  Claude's reason, and `SoldComparison.tsx`: the price on a strip among the last sold copies from the saved price check
  (no new sold-comps call; current listings when nothing sold) and the sales (tap for `ComparableSheet`),
  plus the Discogs price guide when it was checked.
  "Done" removes a listing from Review (only on the phone; it stays on eBay).
  "Edit" (`src/app/auto/EditPublishedSheet.tsx`: title, price, description) sends the draft to
  `/api/listing/revise` (`reviseListing` in `publish.ts`: replaces the inventory item and offer of the same SKU, no republish).
  Since it re-sends the whole saved draft, Update live listings and Collection edits copy what they put on eBay back onto
  that draft (`withLiveChange` / `liveChangeForSku` in `src/lib/auto/auto.ts`). "Try again" on one Auto CD never makes a
  third CD run at once and never un-pauses the run (`useAutoRun` `start(onlyId)`).
- `/update-listings` — `src/app/update-listings/UpdateListingsScreen.tsx` ("Update live listings", linked from Review):
  phone-run batches of the `optimise-listing` skill on the seller's Claude plan (no Claude API credits). The seller types
  both usage percentages and taps "Run next 20": `/api/batch/run` counts CDs of runs still going (`estimateFits`, 80% stop),
  reserves the next listings (`src/lib/liveBatch/queue.ts`: never proposed newest first, then failed/stale, then unsold 60
  days after their last proposal) and fires the seller's Claude Code scheduled task (`fireRoutine`, `ROUTINE_FIRE_URL` /
  `ROUTINE_FIRE_TOKEN`). The cloud session runs the skill's job H and posts proposals (`/api/batch/proposals`,
  `/api/batch/runs/[id]`); the screen polls `/api/batch` every 20 s, shows proposals (old/new title, specifics, price,
  engagement, flags) and sends the ticked ones through `/api/batch/apply` (`applyProposal` in `src/lib/liveBatch/apply.ts`:
  re-read, skip if changed, text then price alone). `/api/batch/run`, `/apply` and `/dismiss` are phone only (`PHONE_ONLY`
  in `src/lib/auth/access.ts`: the key header never opens them). Records in Blob under `batch/` (`src/lib/liveBatch/store.ts`).
- `/collection` — `src/app/collection/CollectionScreen.tsx`: a CD is saved here from the listing
  screen (`src/app/listing/SaveToCollection.tsx`: "Add to Collection", or automatically on publish),
  using the reviewed item specifics and price plus the cover the scan found (handed over in
  sessionStorage by `stashScanned`). Each CD shows cover, album, artist, year, CAD price and user
  categories, with search, category filter, sort, total inventory value and a JSON backup (Restore also shows on the empty collection, for a fresh install). "Mark as sold" in the edit sheet
  saves `soldAt` (date) and an optional `soldPrice` on the CD (phone only, nothing sent to eBay); sold CDs leave the inventory
  value, show under the In stock / Sold / All chips (`filterItems` `status`), and a new copy of a sold CD gets its own entry. Under the price, "Check sold prices"
  (`CollectionSoldPrices.tsx`, in-stock CDs only) shows the last sold copies (`SoldComparison`) and one-tap Quick sale /
  Typical / High prices (`priceChoices` in `src/lib/collection/soldPrices.ts`). Prices already looked up show at once for free:
  the check saved on the CD (`priceCheck`/`priceCheckedAt`, trimmed by `trimCheck`, set when the listing screen or the Auto
  tab adds the CD, or by an earlier Collection check), else the Sort a pile 30-day cache (`collectionCheckKey`, then the by-name `collectionNameKey` Sort uses),
  else To list / Auto (same SKU or barcode). A new lookup runs only on tap ("Check sold prices" / "Check again").
  Saving the picked price updates the eBay listing as any price edit does. Saving an edit to album,
  artist, year or price also updates the live eBay listing (`pushEditToEbay.ts` → `/api/listing/update-details` →
  `applyCollectionEdit` in `src/lib/ebay/listingEdits.ts`: reads the inventory item and offer, changes only the title's
  artist/album, those item specifics and the price (Best Offer decline kept at the same %), and puts them back). It uses
  the CD's `sku` (saved on publish), else the only live SKU `BC-<barcode>-…`. Logic in `src/lib/collection/collection.ts`,
  storage in `src/lib/collection/store.ts` (localStorage on the device, no server DB). Album
  details come from MusicBrainz + Cover Art Archive (`src/lib/music/musicbrainz.ts`, no key),
  added to lookup responses as `album`. When MusicBrainz misses a barcode, Claude Haiku reads artist and album
  off the eBay titles (`src/lib/music/albumFromTitles.ts`). `TabBar` in `ui.tsx` switches Scan / To list / Auto / Review / Collection.

Look and feel: design tokens (light + dark) and component classes (`.page`, `.card`, `.field`,
`.btn btn-primary`, `.notice`, `.skeleton`...) live in `src/app/globals.css`; shared pieces
(`AppBar`, `Spinner`, `StepHeading`, `Logo`, `Icon`, `TabBar`) in `src/components/ui.tsx`. Text uses the type
scale classes `.t-display/.t-title/.t-headline/.t-small/.t-caption` (12px floor, no ad hoc sizes). Selected
states use `.choice` / `.chip-toggle` with `aria-pressed` (tinted + outline + check), never the solid
primary colour, which is kept for the one main action. Icons come from `Icon` only. Since the Sleek redesign
(2026-11-27): sand `brand` for the main action only, tan `accent` for selected/focus outlines, 12px radius, no shadows;
tab screens use `AppBar` without `back` (large title + `subtitle`); grade groups are `.grader` cards, yes/no options
`.switch` rows, the Auto pile a `.rail`. Design rationale and before/after screenshots: `docs/redesign/`. Use the token colours
(`bg-surface`, `text-muted`, `border-line`, `bg-brand`...) rather than raw Tailwind palette colours.

Server code:
- `src/lib/ebay/client.ts` — app-token client (Browse search) used by lookup and pricing.
- `src/lib/ebay/comparables.ts` — Marketplace Insights sold search with Browse fallback.
- `src/lib/pricing/` — price suggestion from comparables; served by `src/app/api/price-suggestion/route.ts`. See `docs/sold-price-data.md`.
- `src/lib/ebay/sell.ts` — user-token client (OAuth, Inventory API, Taxonomy). `fetch` is injectable for tests.
  eBay condition enums live in `src/lib/ebay/conditions.ts` (re-exported by `sell.ts`) so screens can use them
  without bundling the client. Likewise zod schemas stay out of screen code: `SellerConditionSchema` is in
  `src/lib/listing/conditionSchema.ts`, `TITLE_MAX` in `src/lib/listing/limits.ts`. Screens import types only from
  `src/lib/listing/types.ts` (it re-exports `PriceCheck`, `ShelfCd` and the Update live listings shapes as types).
  `PriceCheck` lives in `src/lib/pricing/priceCheck.ts` (with `bestSuggestion`: sold, else listed).
- `src/lib/ebay/publish.ts` — publish flow: location → inventory item → offer (create or update) → publish.
  Ported from `ebay_handler.py` in teodem1/ebay-item-listings-anthropic-claude.
- `src/lib/ebay/oauth.ts` + `src/app/api/ebay/{connect,callback}` — one-time eBay sign-in that shows the refresh token for `EBAY_REFRESH_TOKEN` (needs `EBAY_RUNAME`).
- Promoted Listings: after publish, `/api/listing/publish` adds the listing to a cost-per-sale campaign at `EBAY_PROMOTED_PERCENT` (or the draft's `promotedPercent`) via `EbaySellClient.promoteListing` (needs the `sell.marketing` scope).
- `src/lib/ebay/config.ts` — env settings for both clients. Best Offer auto-declines offers under
  `EBAY_BEST_OFFER_MIN_PERCENT` (the seller uses 70) of the price.
- sold-comps.com allowance: a 429/402 (or a 403 that says limit/quota) is `isSoldCompsLimit`; the price check then
  returns `soldLimitReached` (and `soldRemaining` when a rate-limit header says so). The phone remembers it
  (`src/lib/pricing/soldLimit.ts`) and `SoldLimitBanner` under every `AppBar` warns when it is used up or 10 or fewer are left.
- Claude models (cost): listing writing (`generate.ts` `MODEL`) and cover identification (`vision.ts`) use
  `claude-sonnet-5-5`; Sort a pile (`shelf.ts`, many small spines in one photo) stays on `claude-opus-5-5`; album names
  from eBay titles use Haiku. The listing rules (`SYSTEM`) are prompt-cached (`cache_control`). Claude API errors reach
  the phone as short messages ("Out of Claude API credits...") via `claudeErrorMessage` in `src/lib/claude/errors.ts`.
- `src/lib/identify/` — Claude vision photo identification, barcode helpers.
- `src/lib/listing/generate.ts` — Claude writes the SEO title, item specifics and HTML description, following the
  seller's eBay listing skill (`SYSTEM`): search words first, no marketing words or caps, every applicable item specific
  (optional ones too) using eBay's listed values (`getCategoryAspects` returns them, `aspectLine`), unknowns flagged in
  `checks` rather than invented, description in a fixed order (summary, Key features, Specifications, Condition, What's
  included, Shipping). A graded CD title stays "Artist Album CD (grades)" but fills the 80 characters with `titleExtras`
  (year, label, "Canada"...) put before " CD (" by `cdTitle`. With a barcode, the pressing's label, country, year,
  catalog number and disc count come from MusicBrainz (`albumFacts`, `releaseFactsText`) as certain facts.
  A rare or special edition backed by a fact (seller's words, an uncommon pressing) is the first title extra, with shorter
  forms after "||" (`cdTitle` takes the first that fits). Every CD was bought in Canada: when a sold copy titled Canadian
  sold above the typical other copy (`canadianSoldForMore`, `src/lib/pricing/canadian.ts`, from the saved price check, no
  new lookup), `canadianVersion` makes "Canadian Version" that edition phrase (Listing, Auto and Update live listings).
  When no barcode was scanned, up to 3 photos (front, back) go to Claude (`imageUrls`); a fully visible back cover with no
  barcode makes "Rare No Barcode" the edition phrase (early pressings collectors seek).
  Claude also returns the copy's `edition` (`EDITIONS` in `src/lib/pricing/edition.ts`). `editionPrice` takes the median of
  sold copies titled as that edition when it beats the typical other copy: the listing screen uses it unless the seller
  picked a price (notice with "Use $X"), Auto via `withEditionPrice`, and Update live listings raises (never lowers) a
  live price to it (`applyRefresh` `raise`), from the phone's saved sold prices. Any price change on a live listing
  (Update live listings, Collection edits) keeps that listing's own Best Offer decline/accept share via
  `rescaleBestOfferTerms` in `sell.ts` (the env % only when it had no decline).
  Package weight defaults to 115 g for a CD, +16 g per extra disc in the same case, +115 g per extra disc in a double jewel case (so 230 g) (`packageWeightKg`, `discCount`, `hasDoubleJewelCase` from Claude or the item text; a bare "19 CD" is an album name, only "2CD", "2 CDs", "3 discs", "2 CD set" count; edited in grams) and 12 × 15 × 2.5 cm (`DEFAULT_PACKAGE_CM`, a CD mailer).
  The description says the seller ships only to Canada and the US. On the review step it is the first card (right after the price step's listings) and is edited as plain text
  (`DescriptionEditor.tsx`, `src/lib/listing/descriptionText.ts`: "## " heading, "- " bullet, **bold**) with a Preview tab.
  Publish leaves Brand and MPN empty for CDs/music (`isMusicDraft`, `withoutBrandAndMpn`); other items get them filled
  (`withBrandAndMpn`). On eBay error 25002 (BrandMPN) it re-sends the item the other way once and publishes again.
- `src/app/api/lookup/{barcode,photo}`, `src/app/api/price-suggestion` and `src/app/api/listing/{generate,publish}` — server routes.

Access: with `APP_ACCESS_KEY` set, `src/proxy.ts` (Next 16's renamed middleware) locks every page and API route:
API calls without the `el_access` cookie get 401, pages redirect to `/unlock` (`src/app/unlock/page.tsx` →
`/api/unlock`), which sets an httpOnly cookie holding a SHA-256 of the key for a year (`src/lib/auth/access.ts`).
API calls (never pages) may instead send the key in the `x-elister-key` header, which the seller's Claude
thread gets from a network secret.
Unset, the app stays open.

Env: see `.env.example`. Camera access on a phone needs HTTPS (localhost is fine).

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `teodem1/eBay-Lister`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.
