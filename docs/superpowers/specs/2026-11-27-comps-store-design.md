# Stored SoldComps results and plugin-driven listing updates

Status: awaiting seller approval. "(call)" marks a builder's decision to check.

## Intent
From the existing Claude thread, the plugin rewrites every title, adds missing listing information and
proposes prices from stored sold results, using as few SoldComps lookups and tokens as it can.

## Decided by the seller
- App screens stay as they are. The plugin changes the listings, only after approval.
- Sold results: use the stored copy first; look up only when none exists. Store the full result and filtered sets.
- Storage: private Vercel Blob.
- A detail (no barcode, Canadian version, ...) changes the price with 2 or more matching sales that went higher.
  With exactly 1, it is proposed but not applied right away.
- Every title is rewritten by Claude with research; missing information is added; prices adjusted if needed.
- No Claude API credits (plan usage only); cheapest suitable model.

## App (branch `comps-store`, from `main`; the `worth-it` branch stays undeployed)
1. Private Blob store, one file per lookup: key = barcode digits, else normalised "artist album". (call)
   Holds the date, every sale SoldComps returned (up to 120 per query), and the CD-only, same-grade and
   detail-matched sets. One write per lookup, no list operations.
2. Every sold lookup, including from existing screens, is saved. A failed save never fails the lookup.
3. Cache-first applies to the plugin; the app's own "Check" buttons still fetch fresh. (call)
4. Plugin-only routes behind the existing access key: read stored results; import the backup's 74 checks
   (marked partial, never overwriting a full result); read one live listing in full (no Claude call).
5. Writes use the live app's existing routes: title, item specifics and description via
   `/api/listing/refresh/apply`; price (up or down) via `/api/listing/update-details`.

## Plugin
1. Stop at 80% of five-hour or weekly usage (typed by the seller), checked every 5 CDs.
2. Per CD: read the listing, then stored results; look up only if missing; refresh only if asked.
   Stored results do not expire; their date is shown.
3. Models: Haiku 5.5 researches, once per artist where possible; Sonnet 5.5 writes in batches of 5;
   Opus only when evidence conflicts. The C$40 research test is removed, since every CD is researched. (call)
4. Title: "Artist Album [edition] [year] [label] [genre] CD (grades)", 80 characters. Words come from the
   listing or an opened source matching this pressing. Sold titles show which words go with higher sales;
   a word is used only if true of this copy. Nothing the title already states is dropped.
5. Missing information: add item specifics and description facts that are verified. Never change grades or
   condition. Disagreements and unknowns are listed, not filled.
6. Price (item price, CAD):
   - Base: typical price of stored CD-only, same-grade sales; needs 3 or more, else keep the price. (call)
   - A detail counts only if the seller's copy has it (confirmed by listing or seller) and the matching
     sales' median is above the other sales' median.
   - 2+ matching: proposed price = that median. Several details: the highest one, not added together. (call)
   - 1 matching: shown separately as "pending"; applied only if the seller accepts that item by name.
   - No 25% cap; changes over 50% either way are flagged. (call)
7. Approval: per batch, a table of old and new title, added information, old and new price, evidence and
   date. Only approved items are sent. A listing whose title or price changed since reading is skipped.

## Approaches
- Private Blob (chosen): the plugin reads it directly; adds one store to the project.
- Phone storage plus backup file: no new service, but too small for full results.

## Limits and risks
- **Untested:** whether the Claude app thread can reach the app and hold `ELISTER_ACCESS_KEY` outside chat.
  If not, nothing can be read or applied, so this is tested before anything else is built.
- Blob on Hobby includes 1 GB, 2,000 advanced and 10,000 simple operations a month; exceeding an allowance
  can block access. The expected volume (a few hundred writes) is inside it.
- 134 CDs have no backup check: about 134-268 lookups.
- Sold prices may include Best Offer sales at the asking price.

## Not included
New screens, changes to grades, photos, shipping or promotion, automatic publishing.

## Done when
Tests cover save, cache-first, import, 0/1/2 matching sales and the skip rules; app and plugin tests pass;
a 5-CD trial reports usage. No deployment, Blob store creation or eBay change without approval.
