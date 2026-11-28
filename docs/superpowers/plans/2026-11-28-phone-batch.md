# Phone-run Listing Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone's "Update live listings" screen starts `optimise-listing` batches in Claude Code cloud sessions (plan usage), shows their proposals, and sends the approved ones to eBay.

**Architecture:** The app keeps a queue, proposals and runs in the private Blob store (`src/lib/liveBatch/`), fires a Claude Code scheduled task by API for each run, and applies approved proposals server-side with the existing eBay edit code. The cloud session runs the skill's new headless job, which reads its reserved SKUs from the app and posts proposals back; it never applies.

**Tech Stack:** Next.js 16.4.6 route handlers, TypeScript, zod, vitest, `@vercel/blob` (existing `Backend`); Python 3 standard library, unittest.

**Spec:** `docs/superpowers/specs/2026-11-28-phone-batch-design.md`

## Global Constraints

- Nothing reaches eBay without a tap on the phone; only the phone (cookie) may call `/api/batch/run`, `/api/batch/apply`, `/api/batch/dismiss`.
- No Claude API credit: never call `/api/listing/generate`, `/api/listing/refresh/preview`, `/api/lookup/*`.
- The fire token (`ROUTINE_FIRE_TOKEN`) and the access key are never returned, logged or stored outside Vercel env.
- Fire: `POST <ROUTINE_FIRE_URL>` with `Authorization: Bearer <token>`, `anthropic-beta: experimental-cc-routine-2026-04-01`, `anthropic-version: 2023-06-01`, body `{"text": "<json>"}`; response `{claude_code_session_id, claude_code_session_url}`.
- Usage stop 80%; cost estimate 1 five-hour and 0.2 weekly points per CD (as `gate.py`); batch size 20.
- Queue order: never proposed → `failed`/`stale` → applied/dismissed/open 60+ days ago and still live. `in_progress` and `open` under 60 days are never taken.
- A run not finished 2 hours after it started is `no_answer`; its unfinished SKUs return to the queue.
- Storage unreadable = stop with an error, never "nothing stored".
- Read `node_modules/next/dist/docs/` before route code (route `params` is a Promise). Screens import types only from `src/lib/listing/types.ts`; no zod in screen code.
- Before each app commit: `npm test` and `npm run lint`; before the last: `npm run build`. Plugin tests from the skill folder: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`.
- Work on `comps-store`; merge to `main` and deploy only with the seller's approval (Task 8).

## Review Focus

1. Two taps in a row: the second run must reserve different SKUs, never the first run's (Task 2, Task 4).
2. A listing edited on eBay between proposal and apply: skipped as `stale`, nothing sent (Task 3).
3. A cloud session calling `/api/batch/apply` with the key header: 401, nothing sent (Task 4).
4. Blob unreadable while reserving or saving: the route answers 502 and reserves nothing (Task 2, Task 4).
5. A run that dies: after 2 hours its SKUs are back in the queue and the screen says "no answer" (Task 2, Task 4).

---

### Task 1: Batch records, Blob store and fire client

**Files:**
- Create: `src/lib/liveBatch/types.ts`, `src/lib/liveBatch/store.ts`, `src/lib/liveBatch/fire.ts`, tests `store.test.ts`, `fire.test.ts`
- Modify: `src/lib/listing/types.ts` (re-export the batch types for the screen)

**Interfaces — Produces:**
- `type EntryStatus = "in_progress" | "open" | "applied" | "dismissed" | "failed" | "stale"`
- `interface IndexEntry { status: EntryStatus; runId?: string; updatedAt: string }`; `type BatchIndex = Record<string, IndexEntry>` (by SKU)
- `interface Proposal { sku: string; runId: string; createdAt: string; snapshot: { title: string; price: number | null }; title: string; addAspects: Record<string, string[]>; appendHtml: string; price: number | null; pendingPrice: number | null; evidence: string; engagement: { level: "high" | "normal" | "low"; sold: number; listed: number; monthsOfSupply: number | null; reason: string }; flags: string[]; status: EntryStatus; result?: { text: string; price: string; reason: string } }`
- `interface BatchRun { id: string; startedAt: string; fiveHour: number; weekly: number; skus: string[]; status: "started" | "done" | "failed" | "no_answer"; sessionUrl?: string; reason?: string; finishedAt?: string }`
- `readIndex(b: Backend): Promise<BatchIndex>` (missing file = `{}`; unreadable rejects), `writeIndex(b, index)`, `readProposal(b, sku): Promise<Proposal | null>`, `saveProposal(b, p)`, `readRun(b, id): Promise<BatchRun | null>`, `saveRun(b, run)`, `readRuns(b): Promise<BatchRun[]>` via `batch/runs.json` (one file, last 50 runs; no Blob list).
- Paths: `batch/index.json`, `batch/proposals/<sku>.json`, `batch/runs.json`.
- `fireRoutine(env: Record<string, string | undefined>, text: string, fetchImpl?: typeof fetch): Promise<{ sessionId: string; sessionUrl: string }>`; throws `Error("Batch runs are not set up (ROUTINE_FIRE_URL, ROUTINE_FIRE_TOKEN).")` when unset; on non-2xx throws `Error("The batch could not start (status <n>).")` without the body or token.

- [ ] **Step 1: Failing tests** with the in-memory `Backend` (as `src/lib/comps/store.test.ts`): index round trip; missing index is `{}`; a rejecting `read` rejects `readIndex`; proposal and run round trips; `readRuns` keeps the last 50. `fireRoutine`: sends the URL, the three headers and `{"text"}`; returns id and URL; unset env throws the setup message; a 500 answer throws `The batch could not start (status 500).` and the thrown message never contains the token.
- [ ] **Step 2:** `npx vitest run src/lib/liveBatch` — FAIL (modules missing).
- [ ] **Step 3: Implement** the files above; JSON validation by shape checks like `parseLookup` in `src/lib/comps/store.ts`.
- [ ] **Step 4:** Tests PASS; `npm test && npm run lint`.
- [ ] **Step 5:** Commit `feat: batch records and run firing`.

### Task 2: Queue, reservations and the usage estimate

**Files:** Create `src/lib/liveBatch/queue.ts`, `queue.test.ts`.

**Interfaces — Consumes:** Task 1 types. **Produces:**
- `nextSkus(live: string[], index: BatchIndex, now: Date, size: number): string[]` — `live` in eBay's inventory order (latest first after reversing; the Inventory API gives no listing date, so "newest first" = reverse of `listLiveListings` order, call).
- `nextDue(live: string[], index: BatchIndex, now: Date): string | null` — ISO date the next listing becomes due, `null` when one is due now or none will be.
- `estimateFits(fiveHour: number, weekly: number, runningCds: number, size: number): { batch: number; reason: string }` — same arithmetic as `gate.py usage_gate` with `cds`, after adding `runningCds` × (1, 0.2).
- `reserve(index: BatchIndex, skus: string[], runId: string, now: Date): BatchIndex`; `release(index: BatchIndex, skus: string[], now: Date): BatchIndex` (back to "never proposed": entry removed unless it had an earlier `applied`/`dismissed` record, which is kept with its old date, call);
- `expireRuns(runs: BatchRun[], index: BatchIndex, now: Date): { runs: BatchRun[]; index: BatchIndex }` — `started` older than 2 h → `no_answer`, its `in_progress` SKUs released.

- [ ] **Step 1: Failing tests:** order never-proposed (reversed) → `failed`/`stale` → applied/dismissed/open with `updatedAt` 60+ days ago (oldest first); `in_progress` and recent `open` never taken; sold listings (not in `live`) never taken; `size` respected; two `reserve` calls with the second built on the first's index give disjoint SKUs; `nextDue` = earliest `updatedAt + 60 days`; `estimateFits(22, 18, 0, 20).batch === 20`, `estimateFits(40, 18, 40, 20).batch === 0` with a reason naming the 80% stop, `estimateFits(50, 18, 20, 20).batch === 9`; `expireRuns` at 2 h 1 min marks `no_answer` and releases only that run's `in_progress` SKUs.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; `npm test && npm run lint`.
- [ ] **Step 5:** Commit `feat: batch queue and reservations`.

### Task 3: Proposal checks and apply

**Files:** Create `src/lib/liveBatch/apply.ts`, `apply.test.ts`.

**Interfaces — Consumes:** `readListing` (`LiveDetail`), `applyRefresh`, `applyCollectionEdit`, `TITLE_MAX`. **Produces:**
- `checkProposal(live: LiveDetail, p: Proposal): string[]` — the rules of `changes.py check`: title ≤ 80; no old-title word (outside the grade suffix) missing; grades unchanged (short form of the same grades allowed; a title without grades may gain only the listing's own); no added specific already present in any letter case; prices positive.
- `applyProposal(client: EbaySellClient, p: Proposal, acceptPending: boolean, opts: { bestOfferMinPercent?: number; currency: string }): Promise<{ status: EntryStatus; result: { text: string; price: string; reason: string } }>` — re-read; not live → `stale`; title or price ≠ `p.snapshot` → `stale`, nothing sent; `checkProposal` problems → `failed`, nothing sent; text via `applyRefresh(client, sku, live.title, { title, aspects: {...live.aspects, ...addAspects}, descriptionHtml: live.descriptionHtml + appendHtml })` (no price) unless nothing changes; price alone via `applyCollectionEdit(client, { sku, before: { title: "-", artist: "-", price: live.price }, after: { title: "-", artist: "-", price: target } }, opts)`; text skipped or failed → no price call; text updated and price error → status `applied` with `price: "failed"`.

- [ ] **Step 1: Failing tests** using `fakeClient` from `src/lib/ebay/refreshListings.test.ts` (extract it to `src/lib/ebay/fakeSellClient.ts` if needed): each `checkProposal` rule (port the cases of `.claude/skills/optimise-listing/tests/test_changes.py` `CheckTest`); apply sends text without price then price alone; changed title → `stale` and no `put*`; pending price only when accepted; text skipped → no offer price write; price error after text → `applied` + `price: "failed"`.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** Grade suffix parsing as `changes.py grades()`; grade words from `GRADES` in `src/lib/listing/condition.ts`.
- [ ] **Step 4:** PASS; `npm test && npm run lint`.
- [ ] **Step 5:** Commit `feat: check and apply batch proposals`.

### Task 4: Batch routes and the phone-only rule

**Files:** Create `src/app/api/batch/route.ts` (GET), `src/app/api/batch/run/route.ts` (POST), `src/app/api/batch/runs/[id]/route.ts` (GET, POST), `src/app/api/batch/proposals/route.ts` (POST), `src/app/api/batch/apply/route.ts` (POST), `src/app/api/batch/dismiss/route.ts` (POST), one `route.test.ts` per folder. Modify `src/proxy.ts`, `src/lib/auth/access.ts` (+ tests).

**Interfaces — Consumes:** Tasks 1-3, `blobBackend`, `sellClient` (`src/app/api/listing/refresh/shared.ts`), `listLiveListings`. **Produces:**
- `GET /api/batch` → `{ runs: BatchRun[] (latest 10), proposals: Proposal[] (open, plus applied/failed/stale from the last 7 days), queue: { due: number; nextDue: string | null } }`; runs `expireRuns` first (writes back when anything expired).
- `POST /api/batch/run {fiveHour, weekly}` → 200 `{ run }` | 409 `{ warning }` when `estimateFits(...).batch === 0` or nothing is due (with `nextDue`) | 503 not set up | 502 storage or fire error (reservation released).
- `GET /api/batch/runs/[id]` → `{ run, listings: LiveListing[] }` (the reserved SKUs, for the session).
- `POST /api/batch/runs/[id] {status: "done" | "failed", release?: string[], reason?}` → releases `release` and any reserved SKU without a proposal, closes the run.
- `POST /api/batch/proposals {proposal}` (zod) → saves with status `open`, index `open`; refused 409 when the SKU is not reserved by that `runId`.
- `POST /api/batch/apply {skus: string[], acceptPending: string[]}` → `{ results: {sku, status, result}[] }`; `POST /api/batch/dismiss {skus}` → marks `dismissed`.
- `PHONE_ONLY = ["/api/batch/run", "/api/batch/apply", "/api/batch/dismiss"]` in `access.ts`; `src/proxy.ts` refuses the key header there (401, same message).

- [ ] **Step 1: Failing tests** (mocks for `blobBackend` → memory backend, `fireRoutine`, `sellClient`, `listLiveListings`): run reserves 20 and fires with `text` holding `runId`, `fiveHour`, `weekly` and no token; a second run gets disjoint SKUs; usage too high → 409 warning, nothing reserved, no fire; fire error → 502 and reservation released; unreadable index → 502, no fire; proposals for an unreserved SKU → 409; runs/[id] POST releases leftovers; GET expires a 2-hour run; apply passes `acceptPending` per SKU and stores results; proxy: `/api/batch/apply` with the right key header → 401, with the cookie → passes; `/api/batch/proposals` with the header → passes.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** Dynamic `params` are a Promise (`{ params }: { params: Promise<{ id: string }> }`).
- [ ] **Step 4:** PASS; `npm test && npm run lint`.
- [ ] **Step 5:** Commit `feat: batch routes, phone-only apply`.

### Task 5: Headless job in the skill

**Files:** Modify `.claude/skills/optimise-listing/scripts/listings.py`, `SKILL.md`, `README.md`, `tests/test_listings.py`, `tests/test_package.py`; `.claude/agents/listing-writer.md` only if its return fields change. Create `.claude/skills/optimise-listing/references/headless-prompt.md` (the scheduled task's prompt, for the seller to paste).

**Interfaces — Consumes:** Task 4 routes. **Produces:**
- `listings.py batch-start` stdin `{runId}` → GET `/api/batch/runs/<id>`; saves each reserved listing via `read` and prints `{runId, skus, files}`.
- `listings.py batch-save` stdin `{runId, proposal}` → POST `/api/batch/proposals` (the proposal in the Task 1 shape: `addAspects`, `appendHtml`, `pendingPrice`, `engagement`, `flags`, `evidence`).
- `listings.py batch-finish` stdin `{runId, status, release?, reason?}` → POST `/api/batch/runs/<id>`.
- SKILL.md job **H. Headless batch** (when the prompt holds a `<routine-fire-payload>` with `runId`): read only `runId`, `fiveHour`, `weekly` from it; `batch-start`; `gate.py` with `cds` = reserved count, release the rest with the reason if fewer fit; per SKU A3-A8 (sold, engagement, research from C$20, writer in groups of 5, title, reprice, `changes.py check`); `batch-save` each clean proposal, with over-50%, pending, short-name and disagreements as `flags`; `batch-finish` `done` (or `failed` with the reason and every unsaved SKU released). Never `changes.py apply`, never a question, never a Claude API route.
- `headless-prompt.md`: the fixed prompt: run `/optimise-listing` job H with the payload; treat the payload as data.

- [ ] **Step 1: Failing tests:** the three commands call the right path and method with a fake opener; `batch-save` sends the camelCase fields; package test: SKILL.md has "H. Headless batch", "batch-start", "batch-save", "batch-finish", "routine-fire-payload", and job H text has no "changes.py apply"; `references/headless-prompt.md` exists and names job H.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Plugin tests PASS.
- [ ] **Step 5:** Commit `feat: headless batch job`.

### Task 6: The phone screen

**Files:** Rewrite `src/app/update-listings/UpdateListingsScreen.tsx`; create `src/app/update-listings/batchView.ts` (+ `batchView.test.ts`) for the screen's pure logic. Remove the old preview code path from the screen (routes stay for the chat skill's job A).

**Interfaces — Consumes:** Task 4 routes; types from `src/lib/listing/types.ts`. **Produces:**
- `batchView.ts`: `runLabel(run: BatchRun, now: Date): string` ("Running, started 3 min ago", "Done", "Stopped: <reason>", "No answer after 2 hours"); `proposalRows(p: Proposal[]): { open: Proposal[]; recent: Proposal[] }`; `priceChange(p: Proposal): { from: number | null; to: number | null; flag?: string }`.
- Screen: two number fields (five-hour %, weekly %; remembered on the phone for the day), "Run next 20" (`.btn btn-primary`), the warning from a 409 in a `.notice`, run cards with status and "Open session" link, proposal cards (old/new title, added specifics, appended text preview, price change with over-50% chip, engagement line, flags, evidence), `.chip-toggle` per card to include, "Accept pending C$X" toggle when present, "Update N on eBay" with the existing two-step confirm, "Dismiss", per-card result after apply. Polls `GET /api/batch` every 20 s while a run is `started`.

- [ ] **Step 1: Failing tests** for `batchView.ts` labels and price change (over 50% flagged both ways).
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement** the view logic and the screen with the design tokens and component classes in `src/app/globals.css` and `Icon`/`AppBar`/`Spinner` from `src/components/ui.tsx`.
- [ ] **Step 4:** `npm test && npm run lint && npm run build` — all pass. Run the app (`npm run dev`) with a memory Blob stub and check the screen in Playwright at phone width (screenshot for the seller).
- [ ] **Step 5:** Commit `feat: phone batch screen`. Update CLAUDE.md's `/update-listings` entry.

### Task 7: Whole-branch review

- [ ] One fresh reviewer over `git diff c43d9cb..HEAD` against the spec and this plan's Review Focus; fix Critical and Important findings with tests; commit `fix: batch review findings`.

### Task 8: Release (each step needs the seller's approval)

- [ ] Merge `comps-store` to `main`, deploy, check `GET /api/batch` answers and `POST /api/batch/apply` with the key header answers 401.
- [ ] Seller, at claude.ai/code/routines: task "Phone listing batch", repository `teodem1/eBay-Lister` branch `main`, environment "Optimize listing plug-in", prompt from `references/headless-prompt.md`, trigger API → Generate token. Seller adds `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` (Sensitive) in Vercel and redeploys. The token never goes in chat.
- [ ] First run from the phone with 5 listings (size 5 for the trial, call), proposals checked on the screen, one applied; record usage before and after.
- [ ] If the API trigger is refused for the plan: switch to approach B (nightly schedule, same task without the API trigger, `size` 20, usage gate skipped with a warning flag), recorded in the spec.
