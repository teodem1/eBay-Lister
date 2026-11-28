/**
 * GET /api/batch/sales?sku= : the listing's stored sold sales in its grade, to compare a copy with on
 * the phone. Reads eBay (the live listing, for its barcode and name) and storage only: no sold lookup.
 *   200 { sales, savedAt, partial } (empty when nothing is stored) · 404 not live · 502 eBay or storage error
 */
import { readListing } from "@/lib/ebay/refreshListings";
import { listingSales } from "@/lib/liveBatch/sales";
import { sellClient } from "@/app/api/listing/refresh/shared";
import { batchStore, storageError } from "../shared";

export async function GET(request: Request) {
  const sku = new URL(request.url).searchParams.get("sku")?.trim();
  if (!sku || sku.length > 100) return Response.json({ error: "Provide a sku." }, { status: 400 });
  const b = batchStore();
  if (b instanceof Response) return b;
  const ebay = sellClient();
  if (ebay instanceof Response) return ebay;
  let live;
  try {
    live = await readListing(ebay.client, sku);
  } catch (err) {
    console.error("reading the listing failed", err);
    return Response.json({ error: "The eBay listing could not be read." }, { status: 502 });
  }
  if (!live) return Response.json({ error: "This listing is not live (it sold or ended)." }, { status: 404 });
  try {
    return Response.json(await listingSales(b, live));
  } catch (err) {
    return storageError(err);
  }
}
