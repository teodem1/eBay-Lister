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
  In the APK the buttons use the native camera and ML Kit scanner via `src/lib/native/`;
  in a browser, barcode scan uses the live scanner in `BarcodeScanner.tsx`.
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

## Coding guidelines

From multica-ai/andrej-karpathy-skills (also installed as the `karpathy-guidelines` skill).
**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
