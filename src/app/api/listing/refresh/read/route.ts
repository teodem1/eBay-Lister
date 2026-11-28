import { readListing } from "@/lib/ebay/refreshListings";
import { errorResponse, sellClient } from "../shared";

/**
 * GET ?sku=: one live listing in full (title, price, barcode, item specifics,
 * description, condition text, grades, photos). Read only, no Claude call.
 * 404 when it is not live. Plugin only, behind the access key.
 */
export async function GET(request: Request) {
  const sku = new URL(request.url).searchParams.get("sku")?.trim();
  if (!sku || sku.length > 50) return Response.json({ error: "Provide a sku." }, { status: 400 });
  const ebay = sellClient();
  if (ebay instanceof Response) return ebay;
  try {
    const listing = await readListing(ebay.client, sku);
    if (!listing) return Response.json({ error: "This listing is not live (it sold or ended)." }, { status: 404 });
    return Response.json(listing);
  } catch (err) {
    return errorResponse(err);
  }
}
