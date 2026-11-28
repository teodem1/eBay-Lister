# Phone-run listing batches (skill on plan usage, approved on the phone)

Status: approach A chosen by the seller 2026-11-28 (fallback B). Draft for approval.
"(call)" marks a builder's decision.

## Intent
The seller wants to update live listings entirely from the phone, never through a Claude chat, while the work
still runs on Claude plan usage (the `optimise-listing` skill), not on Claude API credits. The phone's "Update live
listings" screen (Review tab) starts a batch, shows the skill's proposals, and sends the approved ones to eBay.

## Goals
- From "Update live listings": type the two usage percentages, tap "Run next 20", come back later to proposals.
- Each proposal shows old and new title, added item specifics and description text, old and new price,
  engagement (sold, listed now, months of supply), evidence, flags (over 50%, pending, short-name sales).
- The seller ticks proposals and taps "Update N on eBay"; only ticked ones are sent, with the same safety
  checks as `changes.py` (listing re-read, title or price changed since = skipped, nothing dropped, grades kept).
- The next run continues with listings not yet proposed.

## Non-goals
- No chat step anywhere in the normal flow.
- No change to the Scan, To list, Auto, Review and Collection flows.
- No automatic sending: nothing reaches eBay without a tap on the phone.

## Anti-goals (a failure even if it works)
- Any Claude API credit spent by a batch (the app's `/api/listing/generate`, `/refresh/preview`, `/lookup/*`).
- A proposal applied that was never shown, or applied to a listing changed since it was proposed.
- The run token or the access key reaching the phone, a log or a response.
- A second paid sold-comps lookup for a CD already stored.

## Approaches (seller picked A, B as fallback)
- **A. Phone button fires a Claude Code scheduled task by API (chosen).** The app calls
  `POST https://api.anthropic.com/v1/claude_code/routines/<trigger-id>/fire` with the task's bearer token and the
  run's input as `text`. Runs on plan usage, on demand. Needs the seller to create the task and its API token once.
- **B. Nightly scheduled task (fallback).** Same proposals and phone review, but the run starts on a schedule; it
  cannot read the usage percentages, so it runs one batch at night. Used only if A's API trigger is unavailable.
- C. Port the skill into the app on the Claude API: rejected, it spends API credits.

## How it works
1. **One-time setup (seller):** at claude.ai/code/routines create a task "Phone listing batch": repository
   `teodem1/eBay-Lister` (branch `main`), environment "Optimize listing plug-in" (network secret for the app,
   soundtrack sites), prompt = the fixed headless prompt in the plan, trigger = API, "Generate token". The trigger
   id and token go into Vercel as `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` (Sensitive). Nobody pastes the token
   in chat.
2. **Run (phone → app):** the screen posts `{fiveHour, weekly}` to `POST /api/batch/run`. The app checks both
   are below 80%, refuses if a run started in the last 30 minutes is still open (call), records a run in Blob
   (`batch/runs/<id>.json`: status `started`, percentages, time), and fires the task with
   `text = {"runId", "fiveHour", "weekly", "size": 20}`. It stores the returned session URL on the run.
3. **Batch (cloud session, skill job "headless"):** reads the payload; runs the usage gate with `cds: 20` (fewer if
   near the stop); lists live listings; skips SKUs already in the proposal index (any status); for each of the next
   N: `read`, `sold`, `engagement`, research only from C$20, writer in groups of 5, `title.py`, `reprice.py`,
   `changes.py check`; then posts each proposal to `POST /api/batch/proposals` and finally marks the run `done`
   (or `failed` with a reason) via `POST /api/batch/runs/<id>`. It never applies anything and never asks a question:
   anything that would need the seller (a pending price, an over-50% change, disagreements) becomes a flag on the
   proposal.
4. **Review (phone):** the screen polls `GET /api/batch` while a run is open (call: every 20 s) and shows the run
   status, the session link, and the open proposals.
5. **Apply (phone → app):** `POST /api/batch/apply {skus, acceptPending: [skus]}`. Server-side, per SKU: re-read the
   listing; skip if title or price differs from the proposal's snapshot; re-run the proposal checks against the
   fresh listing; send text through `applyRefresh` (old specifics + additions, old description + appended text, no
   price); then the price alone through `applyCollectionEdit` (pending price only if accepted). Record per SKU
   `updated | unchanged | skipped | failed` for text and price, as `changes.py` does. A dismissed proposal is kept
   as `dismissed` so the next run skips that SKU.

## Fire API (from Claude Code's docs, read 2026-11-28: code.claude.com/docs/en/routines)
- `POST https://api.anthropic.com/v1/claude_code/routines/<trigger-id>/fire`, headers
  `Authorization: Bearer <token>`, `anthropic-beta: experimental-cc-routine-2026-04-01`,
  `anthropic-version: 2023-06-01`, `Content-Type: application/json`; body `{"text": "..."}`.
- `text` reaches the session wrapped in a `<routine-fire-payload>` block marked as untrusted data, so the task's
  saved prompt tells the session to read the run id and percentages from it (and nothing else).
- Response: `{"type": "routine_fire", "claude_code_session_id", "claude_code_session_url"}`; the run stores both.
- Available on Pro (the seller's plan); runs count against the account's usage. The token is shown once when
  generated. Hourly caps exist (about 30 fires per task per hour, per a summary of the docs); the 30-minute
  "one open run" rule stays far below them. The beta header may change: a non-2xx answer marks the run `failed`
  with the status, and the screen says so. If the API trigger turns out unavailable, approach B applies.
- Runs start in auto mode; a run that stops for a permission prompt shows as "waiting" via its session link.

## Data (private Blob, same store)
- `batch/proposals/<sku>.json`: snapshot (title, price, aspects names, description length), proposal (title,
  add_aspects, append_html, price, pending), evidence, engagement, flags, runId, status
  (`open | applied | dismissed | failed`), times.
- `batch/index.json`: sku → status and updatedAt, one file, written by the app only. The session reads it through
  `GET /api/batch/index` (it has no Blob token).
- Statuses and the queue (call): `open` (shown, waiting) and `applied` / `dismissed` (done) are skipped by later
  runs; `failed` and `stale` (the listing changed before apply) go back into the queue. Open proposals stay open
  across runs.
- `batch/runs/<id>.json`: run record.

## Constraints
- All new routes under `/api/*`, behind `src/proxy.ts` (cookie on the phone, `x-elister-key` from the session).
- The fire token is read only server-side; never returned or logged.
- Proposal checks exist twice (Python `changes.py check` in the session, TypeScript at apply time): the TypeScript
  one is the gate that matters; both follow the same rules (call).
- The old Claude-API preview on this screen is removed, with its "Find" and edition-raise path (call: it spends
  credits; `reprice.py` details cover the edition raise). The screen becomes the batch flow.
- Only the phone applies batch proposals: `src/proxy.ts` refuses the `x-elister-key` header on `/api/batch/apply`
  (cookie only), so a cloud session cannot apply what was never shown (call). The chat skill's own apply path
  (job A, existing routes) is unchanged.
- Built on `comps-store`, reviewed, then merged to `main` and deployed once with the seller's approval; the
  scheduled task runs on `main`.
- Usage stop 80% stays; the phone asks for both percentages before each run.

## Left to the builder
Polling interval, run timeout (a run `started` over 2 hours shows as "no answer" with its session link), screen
layout within the existing design tokens, exact headless prompt wording, how the session reports partial progress.
