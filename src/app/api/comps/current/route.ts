/**
 * GET /api/comps/current?barcode=&name=
 *
 * How many copies of a CD are listed on eBay now (CDs only), for the plugin's
 * engagement measure: copies listed against how fast copies sell. eBay Browse only,
 * never a sold-comps.com lookup. Plugin only, behind the access key.
 *   200 { count, capped, matchedBy } (capped: the search limit was reached, so count is a floor)
 *   400 no barcode or name · 502 eBay failed
 */
import { getEbayClient } from "@/lib/ebay";
import { findCurrentListings } from "@/lib/ebay/comparables";
import { onlyCds } from "@/lib/pricing/version";

const LIMIT = 200;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const digits = (params.get("barcode") ?? "").replace(/\D/g, "");
  const gtin = digits.length >= 8 && digits.length <= 14 ? digits : undefined;
  const name = params.get("name")?.trim() || undefined;
  if (!gtin && !name) return Response.json({ error: "Provide a barcode or a name." }, { status: 400 });
  try {
    const ebay = getEbayClient();
    const { items, matchedBy } = await findCurrentListings(ebay, {
      gtin,
      keywords: name,
      limit: LIMIT,
      destinationCountry: ebay.config.marketplaceId.replace(/^EBAY_/, ""),
    });
    return Response.json({ count: onlyCds(items, name).length, capped: items.length >= LIMIT, matchedBy });
  } catch (err) {
    console.error("current listings count failed", err);
    return Response.json({ error: "eBay current listings could not be read." }, { status: 502 });
  }
}
