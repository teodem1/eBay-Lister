/**
 * POST /api/price-suggestion
 *
 * Body (JSON): ComparableQuery plus optional `myShippingCost`, e.g.
 *   { "gtin": "0045496590093", "destinationCountry": "CA", "conditionIds": ["3000"] }
 *
 * Returns two suggestions, each with the comparables used:
 *   current: from active eBay listings (asking prices, Browse API)
 *   sold:    from items sold in the last SOLD_LOOKBACK_DAYS days (default 365) (Marketplace Insights, or
 *            sold-comps.com when SOLD_COMPS_API_KEY is set), null when neither
 *            is available; `unavailable.sold` says why.
 * Runs server-side so the eBay client secret never reaches the phone.
 */
import { blobBackend, saveLookup } from "@/lib/comps/store";
import type { SoldQuery } from "@/lib/comps/record";
import { getEbayClient } from "@/lib/ebay";
import { findBothComparables } from "@/lib/ebay/comparables";
import { SOLD_LIMIT_NOTE, soldLookbackDays } from "@/lib/ebay/soldComps";
import type { ComparableQuery, ComparableResult } from "@/lib/ebay/types";
import { suggestPrice, type LearnedPosition } from "@/lib/pricing/suggestPrice";
import { engagementLevel, learnedPosition } from "@/lib/learning/outcomes";
import { readOutcomes } from "@/lib/learning/store";
import { onlyCds, sameCondition, searchName } from "@/lib/pricing/version";
import type { Condition } from "@/lib/ebay/sell";

export async function POST(request: Request) {
  let body: ComparableQuery & { myShippingCost?: number; sellerCondition?: Condition };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body?.keywords && !body?.gtin && !body?.epid) {
    return Response.json(
      { error: "Provide keywords, gtin or epid." },
      { status: 400 },
    );
  }

  try {
    const { myShippingCost, sellerCondition, ...query } = body;
    const ebay = getEbayClient();
    // Quote shipping to the marketplace's own country unless told otherwise
    // (EBAY_CA -> CA).
    query.destinationCountry ??= ebay.config.marketplaceId.replace(/^EBAY_/, "");
    const soldQueries: SoldQuery[] = [];
    const both = await findBothComparables(ebay, query, {
      soldCompsApiKey: process.env.SOLD_COMPS_API_KEY || undefined,
      soldLookbackDays: soldLookbackDays(process.env.SOLD_LOOKBACK_DAYS),
      onSoldQuery: (by, items) => soldQueries.push({ by, items }),
    });
    // Every paid sold lookup is stored (empty ones too, so they are not bought again).
    // A failed save is logged and never fails the price check.
    const store = both.sold && soldQueries.length ? blobBackend() : null;
    if (store) {
      try {
        await saveLookup(store, {
          savedAt: new Date().toISOString(),
          partial: false,
          barcode: query.gtin,
          // The name the search used, as the plugin reads it (lookups by barcode are keyed by the barcode).
          name: query.keywords && searchName(query.keywords),
          condition: sellerCondition,
          queries: soldQueries,
        });
      } catch (err) {
        console.error("saving sold lookup failed", err);
      }
    }
    // The current price is shown as what similar items are listed at, so no
    // asking-to-sold discount is applied to it.
    // The seller lists CDs: cassettes, vinyl, lots and signed copies never reach the screen.
    // With the seller's grades, only copies in that condition count (sealed vs used, same grade).
    const cdsOnly = (r: ComparableResult | null) =>
      r && { ...r, items: sameCondition(onlyCds(r.items, query.keywords), sellerCondition) };
    // The seller's own sales teach where CDs with this much interest sell (src/lib/learning): the typical
    // sold price is taken there. Interest is CD sales in any grade against CDs listed now in any grade, the
    // same measure a sale was recorded with and the skill uses. Needs both sides; any failure keeps the median.
    let learned: LearnedPosition | undefined;
    const soldCds = cdsOnly(both.sold);
    const anyGrade = (r: ComparableResult | null) => r && onlyCds(r.items, query.keywords);
    const soldAnyGrade = anyGrade(both.sold);
    const listedAnyGrade = anyGrade(both.current);
    const learningStore = soldAnyGrade && listedAnyGrade ? blobBackend() : null;
    if (learningStore && soldAnyGrade && listedAnyGrade) {
      try {
        const level = engagementLevel(soldAnyGrade, new Date().toISOString(), listedAnyGrade.length);
        const position = learnedPosition(await readOutcomes(learningStore), level);
        if (position) learned = { ...position, level };
      } catch (err) {
        console.error("reading sale records failed", err);
      }
    }
    const suggest = (raw: ComparableResult | null, unit: string, r = cdsOnly(raw), learnedAt?: LearnedPosition) =>
      r
        ? {
            suggestion: suggestPrice(r, {
              myShippingCost,
              activeListingDiscount: 0,
              // Most of the seller's CDs are Canadian pressings: price from Canadian copies.
              homeCountry: query.destinationCountry,
              keywords: query.keywords,
              unit,
              learned: learnedAt,
            }),
            comparables: r,
          }
        : null;
    return Response.json({
      current: suggest(both.current, "listings"),
      sold: suggest(both.sold, "sales", soldCds, learned),
      unavailable: both.unavailable,
      soldLimitReached: both.soldLimitReached,
      soldRemaining: both.soldRemaining,
    });
  } catch (err) {
    console.error("price-suggestion failed", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
        ...(err instanceof Error && err.message === SOLD_LIMIT_NOTE && { soldLimitReached: true }),
      },
      { status: 502 },
    );
  }
}
