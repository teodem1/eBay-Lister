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

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.
