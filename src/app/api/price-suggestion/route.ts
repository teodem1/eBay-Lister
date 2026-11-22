/**
 * POST /api/price-suggestion
 *
 * Body (JSON): ComparableQuery plus optional `myShippingCost`, e.g.
 *   { "gtin": "0045496590093", "destinationCountry": "CA", "conditionIds": ["3000"] }
 *
 * Returns the price suggestion and the comparables used. Runs server-side so
 * the eBay client secret never reaches the phone.
 */
import { EbayClient } from "@/lib/ebay/client";
import { findComparables } from "@/lib/ebay/comparables";
import { loadEbayConfig } from "@/lib/ebay/config";
import type { ComparableQuery } from "@/lib/ebay/types";
import { suggestPrice } from "@/lib/pricing/suggestPrice";

let client: EbayClient | null = null;
function getClient(): EbayClient {
  client ??= new EbayClient(loadEbayConfig());
  return client;
}

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
    const ebay = getClient();
    // Quote shipping to the marketplace's own country unless told otherwise
    // (EBAY_CA -> CA).
    query.destinationCountry ??= ebay.config.marketplaceId.replace(/^EBAY_/, "");
    const comparables = await findComparables(ebay, query);
    const suggestion = suggestPrice(comparables, { myShippingCost });
    return Response.json({ suggestion, comparables });
  } catch (err) {
    console.error("price-suggestion failed", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
