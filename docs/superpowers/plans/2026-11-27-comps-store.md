# Stored SoldComps results and plugin-driven updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the seller's Claude thread, the plugin rewrites live titles, adds missing information and reprices from stored sold results, after approval.

**Architecture:** The app saves every sold lookup to private Vercel Blob and exposes read and import routes behind the existing access key. The plugin reads stored results first, does arithmetic and safety checks in Python, and writes through the app's two existing update routes.

**Tech Stack:** Next.js 16.4.6, TypeScript, zod, vitest, `@vercel/blob` ^2.9.0; Python 3 standard library, unittest.

**Spec:** `docs/superpowers/specs/2026-11-27-comps-store-design.md`

**Repos:** app = `/home/claude/teodem1/ebay-lister` (branch `comps-store`); plugin = `/home/claude/ebay-cd-optimiser` (new branch `comps-flow` from `build`).

## Global Constraints

- App screens do not change. The `worth-it` branch stays undeployed.
- Nothing reaches eBay without the seller's approval of that batch.
- No Claude API features: never call `/api/listing/generate`, `/api/listing/refresh/preview`, `/api/lookup/*`.
- Never request, print or store the access key or SoldComps key. The plugin reads `ELISTER_URL`, `ELISTER_ACCESS_KEY`.
- No real eBay, SoldComps, Blob or Claude calls while building: tests use fakes.
- No push, deployment, Blob store creation or eBay change without approval.
- Web research only when the listing's asking price is **C$20 or more**. Plan usage stop **80%**, rechecked every **5** CDs.
- Haiku researches, Sonnet writes in batches of **5**, Opus only on conflicting evidence.
- Title ≤ **80** characters. Grades and condition never change.
- Price: base needs **3** sales; a detail applies with **2+** matches, **1** is pending; changes over **50%** are flagged; CAD only.
- App: read `node_modules/next/dist/docs/` before route code. Before each app commit: `npm test`, `npm run lint`; before the last: `npm run build`.
- Plugin tests: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`.
- Commit messages end with the session's `Co-Authored-By` and `Claude-Session` lines.

## Review Focus

1. Storage unreadable: expected to stop, never to treat it as "not stored" and spend lookups (Tasks 2, 6).
2. A paid lookup that fails to save: expected to be used once and reported, never repeated (Task 6).
3. A rewrite that drops an item specific, description text or a grade: expected to be refused (Task 8).
4. A CD with no barcode and a blank or symbol-only name: expected to be skipped, never stored under a shared key (Task 1).
5. Title and details saved but price update fails: expected to report exactly what changed (Task 8).

---

### Task 0: Thread access gate (seller, no code). Stop if it fails.

- [ ] **Step 1:** In the Claude thread's code environment settings (not in chat), add `ELISTER_URL` = `https://e-bay-lister-nu.vercel.app` and `ELISTER_ACCESS_KEY`, and allow that host in network access. Whether the seller's thread offers these settings is **unverified**.
- [ ] **Step 2:** In the thread, run:

```bash
python3 - <<'EOF'
import json, os, urllib.request, urllib.error
u = os.environ.get("ELISTER_URL", ""); k = os.environ.get("ELISTER_ACCESS_KEY", "")
print("url set:", bool(u), "| key set:", bool(k))
try:
    r = urllib.request.urlopen(urllib.request.Request(u + "/api/unlock",
        json.dumps({"key": k}).encode(), {"Content-Type": "application/json"}), timeout=30)
    print("unlock status:", r.status)
except urllib.error.HTTPError as e:
    print("unlock status:", e.code)
except Exception as e:
    print("unreachable:", type(e).__name__)
EOF
```

Expected: `url set: True | key set: True` and `unlock status: 200`. Anything else: stop and revisit the design.

### Task 1: Lookup record and keys (app)

**Files:** Create `src/lib/comps/record.ts`, `src/lib/comps/record.test.ts`. Modify `src/lib/pricing/edition.ts` (export the matcher).

**Interfaces — Produces:**
- `matchesEdition(title: string, edition: Exclude<Edition,"none">): boolean`
- `type SoldQuery = { by: "barcode" | "keywords"; items: Comparable[] }`
- `interface StoredLookup { version: 1; savedAt: string; partial: boolean; barcode?: string; name?: string; condition?: Condition; queries: SoldQuery[]; filtered: Filtered }`
- `interface Filtered { cdOnly: string[]; sameGrade: string[]; detail: Record<Exclude<Edition,"none">, string[]> }` (item ids)
- `lookupKeys(q: { barcode?: string; name?: string }): string[]`
- `filterLookup(queries: SoldQuery[], name?: string, condition?: Condition): Filtered`

- [ ] **Step 1: Failing tests**
  - `lookupKeys({barcode:"0075678154323", name:"Genesis Wind & Wuthering"})` equals `["comps/upc/075678154323.json","comps/name/genesis-wind-wuthering.json"]`
  - `"Amélie  Poulain!"` gives `comps/name/amelie-poulain.json`
  - `{name:"???"}` and `{barcode:"123"}` give `[]`
  - `filterLookup` uses the **last** query's items (the set the app prices from); drops a vinyl title; with `LIKE_NEW` and 3 like-new sales keeps only those; lists a "Canadian" title under `detail.canadian`
- [ ] **Step 2:** `npx vitest run src/lib/comps` — FAIL, module missing.
- [ ] **Step 3: Implement.** Barcode: 8–14 digits through `barcodeKeyword`. Name: NFKD, strip marks, lowercase, non letter/number runs to `-`, trim, max 120. Filtering: `onlyCds` then `sameCondition`.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat: stored sold lookup record`.

### Task 2: Blob store (app)

**Files:** Create `src/lib/comps/store.ts`, `store.test.ts`. Modify `package.json`.

**Interfaces — Consumes:** Task 1. **Produces:**
- `interface Backend { read(path: string): Promise<string | null>; write(path: string, body: string): Promise<void> }`
- `blobBackend(env?: NodeJS.ProcessEnv): Backend | null`
- `readLookup(b: Backend, keys: string[]): Promise<StoredLookup | null>`
- `saveLookup(b: Backend, input: Omit<StoredLookup,"version"|"filtered">): Promise<"saved" | "kept" | "no_key">`

- [ ] **Step 1: Failing tests** with an in-memory `Backend`: second key found when first is absent; a rejecting `read` makes `readLookup` reject; unreadable JSON rejects; partial over full returns `"kept"` and writes nothing; full over partial `"saved"`; one `write` per save, to `keys[0]`; no key returns `"no_key"`; `blobBackend({})` is `null`.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** `npm install @vercel/blob@^2.9.0`; confirm the private `get`/`put` signatures in the installed types. `put` with `access:"private"`, `addRandomSuffix:false`, `allowOverwrite:true`; no `list`. Backend exists when `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` is set. Only a partial save reads before writing.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: private blob store for sold lookups`.

### Task 3: Save every sold lookup (app)

**Files:** Modify `src/lib/ebay/comparables.ts` (+ test), `src/app/api/price-suggestion/route.ts`. Create `src/app/api/price-suggestion/route.test.ts`.

**Interfaces — Produces:** `BothOptions.onSoldQuery?: (by: "barcode"|"keywords", items: Comparable[]) => void`

- [ ] **Step 1: Failing tests:** barcode with 1 sale then name fallback calls `onSoldQuery` twice, in that order, with unfiltered items. Route (mocked eBay client, comps search and backend): success saves once with both queries, `partial:false`, the body's `gtin`, `keywords`, `sellerCondition`; a rejecting save still answers 200 with the same body; a failed sold search saves nothing; an empty sold result is saved (so it is not bought again).
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** Await the save inside `try/catch` and log; skip when `blobBackend()` is null.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: save every sold lookup`.

### Task 4: Read and import routes (app)

**Files:** Create `src/lib/comps/importBackup.ts` (+ test), `src/app/api/comps/route.ts` (+ test), `src/app/api/comps/import/route.ts`.

**Interfaces — Produces:**
- `GET /api/comps?barcode=&name=&condition=` → `{found:false}` | `{found:true, lookup: StoredLookup, filtered: Filtered}` (filtered recomputed for `condition`); 400 no usable key; 503 storage not set up; 502 read error
- `POST /api/comps/import` `{items:[{barcode?, priceCheckedAt, priceCheck:{keywords, condition?, soldItems}}]}` (≤300) → `{saved, kept, skipped}`
- `importBackup(b: Backend, items): Promise<{saved:number; kept:number; skipped:number}>`

- [ ] **Step 1: Failing tests:** each status above; import marks `partial:true`, `savedAt` = `priceCheckedAt`, one `keywords` query; empty or missing `soldItems` counts as skipped; an existing full lookup counts as kept.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** zod validation; require `itemId`, `title`, `price.value`, `price.currency` per sale. The proxy already guards `/api/*`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: stored lookup read and backup import`.

### Task 5: Read one live listing (app)

**Files:** Modify `src/lib/ebay/refreshListings.ts` (+ test). Create `src/app/api/listing/refresh/read/route.ts`.

**Interfaces — Produces:** `GET /api/listing/refresh/read?sku=` → `{sku, listingId?, title, price?, currency?, barcode?, query, aspects, descriptionHtml, conditionDescription?, sellerCondition?, imageUrls}`; 404 when not live. `readListing(client, sku): Promise<LiveDetail | null>`

- [ ] **Step 1: Failing tests** using the file's `fakeClient`: values for the fixture (`price 17.5`, `currency "CAD"`, `barcode "075678154323"`, `query "Genesis Wind & Wuthering"`); `null` without a published offer; no `put*` call.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement** with the existing private helpers.
- [ ] **Step 4:** `npm test && npm run lint && npm run build` — all pass.
- [ ] **Step 5:** Commit `feat: read one live listing`.

### Task 6: Cache-first client (plugin)

**Files:** Modify `skills/optimise-listing/scripts/app_client.py`. Create `scripts/listings.py`, `tests/test_listings.py`.

**Interfaces — Consumes:** routes of Tasks 4, 5. **Produces:**
- `app_client.App(url, key, opener=None)` with `.get(path, params=None) -> dict`, `.post(path, body) -> dict`; same URL check, no redirects, raises `AppUnavailable`
- `listings.sold(app, listing, refresh=False) -> {"source": "stored"|"lookup"|"lookup_unsaved", "partial": bool, "saved_at": str|None, "data_file": str}`; the file holds `{"lookup", "filtered"}`
- CLI `listings.py check|list|read|sold|import` (JSON on stdin); `check` prints only `{"reachable","authorised"}`; `read` and `sold` write private files and print a short headline with paths

- [ ] **Step 1: Failing tests** (fake opener): stored hit makes no `/api/price-suggestion` call; miss makes exactly one, then reads again → `"lookup"`; 502 or 503 from `/api/comps` raises and makes **no** lookup; second read still empty → `"lookup_unsaved"`, one lookup, items taken from the answer; `soldLimitReached` raises; `refresh=True` looks up once; `import` sends only items with `soldItems`; no output contains the key. Existing `test_app_client.py` still passes.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement.** Send `barcode`, `name` = `listing.query`, `condition` = `sellerCondition.condition`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: cache-first sold lookups`.

### Task 7: Repricing and research threshold (plugin)

**Files:** Create `scripts/reprice.py`, `tests/test_reprice.py`. Modify `scripts/gate.py`, `tests/test_gate.py`.

**Interfaces — Produces:**
- `reprice.reprice(current, items, details) -> {"base", "count", "proposed", "applied_detail", "pending": {"detail","price"}|None, "over_50", "reason"}`; `items` = the same-grade sales, `details` = edition names confirmed on the seller's copy
- `gate.research_needed(price) -> bool` (replaces `research_gate`)

- [ ] **Step 1: Failing tests** (CAD item prices):
  - current 18, `[10,12,14]` → proposed 12
  - current 18, `[10,12]` → proposed 18, base `None`
  - current 10, others `[10,11,12]`, Canadian `[20,22]` → proposed 21, `over_50` true
  - current 12, others `[10,11,12]`, Canadian `[30]` → proposed 11.5, pending `{"canadian", 30}`
  - Canadian median 21 and no-barcode median 25, two sales each → 25, not summed
  - matching median not above the others', or every sale matching → detail ignored
  - unconfirmed detail ignored; non-CAD sales ignored; missing current price → `proposed` `None`
  - `research_needed(20)` true, `19.99` false, `None` false
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement** with `statistics.median`, `pricing.EDITIONS`, 2 decimals. No percentage cap. No detail raise without a base. Highest pending only if above `proposed`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: stored-sales repricing`.

### Task 8: Check and apply approved changes (plugin)

**Files:** Create `scripts/changes.py`, `tests/test_changes.py`.

**Interfaces — Consumes:** `App` (Task 6). **Produces:**
- `check(snapshot, proposal) -> list[str]` (problems); proposal = `{"sku","title","add_aspects","append_html","price","pending_price"}`
- `apply(app, snapshot, proposal, accept_pending=False) -> {"sku","text": "updated"|"unchanged"|"skipped"|"failed","price": same set,"reason"}`
- CLI `changes.py check|apply`; `apply` takes `approved` and `accept_pending` SKU lists

- [ ] **Step 1: Failing tests:** problems for title over 80; a word of the old title (outside the grade suffix) missing; grades changed (short form of the same grades allowed); an added specific that already exists in any letter case. Apply: SKU not in `approved` sends nothing; title or price differing from the snapshot on re-read skips both; text goes to `/api/listing/refresh/apply` as old specifics plus additions and old description plus `append_html`, **without** `price`; price goes to `/api/listing/update-details` with `sku` only (no barcode), `before`/`after` = `{"title":"-","artist":"-","price":...}`; pending price used only when accepted; text ok and price error → `"updated"` / `"failed"`; text skipped → no price call.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Implement;** `apply` runs `check` first and refuses on any problem.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: approved listing changes`.

### Task 9: Skill, agents, version (plugin)

**Files:** Modify `skills/optimise-listing/SKILL.md`, `agents/*.md`, `README.md`, `.claude-plugin/plugin.json`, `tests/test_package.py`.

- [ ] **Step 1: Failing tests:** version `0.4.0`; SKILL.md contains `C$20`, `every 5 CDs`, `batches of 5`, `Nothing is sent without approval`, `once per artist`, `only when evidence conflicts`, and each new script name; no `not worth deeper research`.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3: Write.** Live-listing batch flow: usage gate → `list` → per CD `read`, `sold` → research if `research_needed` → write → `reprice` → `check` → approval table (old/new title, added information, old/new price, pending, evidence, date, over-50% flag) → `apply`. Only verified facts; list disagreements and unknowns. Titles are built with `title.py` as artist and album, then edition, year, label, genre; the writer reads the stored sold titles for words that go with higher sales and uses one only if true of this copy. Keep the single unlisted-CD flow, minus the C$40 gate, still publishing nothing (builder's call).
- [ ] **Step 4:** Tests PASS; `claude plugin validate .` passes.
- [ ] **Step 5:** Commit `feat: live listing batch flow 0.4.0`.

### Task 10: Release (each step needs the seller's approval)

- [ ] Create a private Blob store and connect it to `e-bay-lister` (Production).
- [ ] Merge `comps-store`, deploy, confirm the locked message still appears without the key.
- [ ] Install plugin 0.4.0; `listings.py check` → reachable and authorised.
- [ ] Import the backup (expected: 68 of its 74 checks carry sales; 6 are skipped).
- [ ] 5-CD trial: record both usage percentages before and after; apply nothing until the table is approved.
