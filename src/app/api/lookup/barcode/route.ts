import { getEbayClient } from "@/lib/ebay";
import { errorResponse } from "@/lib/api-errors";
import { normalizeGtin } from "@/lib/identify/barcode";
import type { LookupResponse } from "@/lib/lookup";

/** POST { code: "0045496453435" } -> eBay listings for that barcode. */
export async function POST(request: Request) {
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { code }" }, { status: 400 });
  }
  const gtin = typeof body.code === "string" ? normalizeGtin(body.code) : null;
  if (!gtin) {
    return Response.json(
      { error: "That doesn't look like a UPC, EAN or ISBN barcode." },
      { status: 400 },
    );
  }

  try {
    const ebay = getEbayClient();
    const notes: string[] = [];
    let results = await ebay.searchItems({ gtin });
    let query: string | undefined;
    if (results.items.length === 0) {
      // Many listings don't carry the barcode field; the number in the title often works.
      query = gtin;
      results = await ebay.searchItems({ q: gtin });
      notes.push("No listing is tagged with this barcode, so these are keyword matches.");
    }
    const payload: LookupResponse = { source: "barcode", gtin, query, results, notes };
    return Response.json(payload);
  } catch (err) {
    return errorResponse(err);
  }
}
