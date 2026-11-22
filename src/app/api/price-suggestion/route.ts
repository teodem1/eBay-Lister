/**
 * POST /api/price-suggestion
 *
 * Body (JSON): ComparableQuery plus optional `myShippingCost`, e.g.
 *   { "gtin": "0045496590093", "destinationCountry": "CA", "conditionIds": ["3000"] }
 *
 * Returns two suggestions, each with the comparables used:
 *   current: from active eBay listings (asking prices, Browse API)
 *   sold:    from items sold in the last 90 days (Marketplace Insights, or
 *            sold-comps.com when SOLD_COMPS_API_KEY is set), null when neither
 *            is available; `unavailable.sold` says why.
 * Runs server-side so the eBay client secret never reaches the phone.
 */
import { getEbayClient } from "@/lib/ebay";
import { findBothComparables } from "@/lib/ebay/comparables";
import type { ComparableQuery, ComparableResult } from "@/lib/ebay/types";
import { suggestPrice } from "@/lib/pricing/suggestPrice";

export async function POST(request: Request) {
  let body: ComparableQuery & { myShippingCost?: number };
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
    const { myShippingCost, ...query } = body;
    const ebay = getEbayClient();
    // Quote shipping to the marketplace's own country unless told otherwise
    // (EBAY_CA -> CA).
    query.destinationCountry ??= ebay.config.marketplaceId.replace(/^EBAY_/, "");
    const both = await findBothComparables(ebay, query, {
      soldCompsApiKey: process.env.SOLD_COMPS_API_KEY || undefined,
    });
    // The current price is shown as what similar items are listed at, so no
    // asking-to-sold discount is applied to it.
    const suggest = (r: ComparableResult | null) =>
      r ? { suggestion: suggestPrice(r, { myShippingCost, activeListingDiscount: 0 }), comparables: r } : null;
    return Response.json({
      current: suggest(both.current),
      sold: suggest(both.sold),
      unavailable: both.unavailable,
    });
  } catch (err) {
    console.error("price-suggestion failed", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
