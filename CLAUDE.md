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
- APK (later, via Capacitor): `npx cap sync android`, then `npx cap open android`

Copy `.env.example` to `.env` and fill in your eBay keys (use `EBAY_ENV=sandbox`
while developing).

## Structure

- `src/lib/ebay/` — eBay client (app token + Browse search). Server-only.
- `src/lib/identify/` — Claude vision photo identification, barcode helpers.
- `src/app/api/lookup/{barcode,photo}/route.ts` — lookup API routes.
- `src/components/ItemLookup.tsx` — phone page: photo, barcode scan, results.

Env: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV`, `EBAY_MARKETPLACE_ID`,
`ANTHROPIC_API_KEY`. Camera access on a phone needs HTTPS (localhost is fine).

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.
