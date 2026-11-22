import { getEbayClient } from "@/lib/ebay";
import { errorResponse } from "@/lib/api-errors";
import { normalizeGtin } from "@/lib/identify/barcode";
import { identifyFromPhoto, type ImageMediaType } from "@/lib/identify/vision";
import type { LookupResponse } from "@/lib/lookup";

const MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Claude accepts up to 5 MB per image; the page shrinks photos well below this.
const MAX_BYTES = 5 * 1024 * 1024;

/** POST multipart form with an `image` file -> Claude's identification + eBay listings. */
export async function POST(request: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("image");
  } catch {
    return Response.json({ error: "Send a multipart form with an image field." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "No photo received." }, { status: 400 });
  }
  if (!MEDIA_TYPES.includes(file.type as ImageMediaType)) {
    return Response.json({ error: `Unsupported image type: ${file.type || "unknown"}.` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Photo is too large (max 5 MB)." }, { status: 413 });
  }

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const identification = await identifyFromPhoto(base64, file.type as ImageMediaType);
    const notes: string[] = [];

    if (!identification.identified) {
      notes.push("Claude couldn't name this item. Try a closer photo, or scan the barcode.");
      const payload: LookupResponse = {
        source: "photo",
        identification,
        results: { total: 0, items: [] },
        notes,
      };
      return Response.json(payload);
    }

    const ebay = getEbayClient();
    const gtin = identification.gtin ? normalizeGtin(identification.gtin) ?? undefined : undefined;
    let results = gtin ? await ebay.searchItems({ gtin }) : { total: 0, items: [] };
    let query: string | undefined;
    if (results.items.length === 0) {
      query = identification.searchQuery || identification.title;
      results = await ebay.searchItems({ q: query });
    }
    if (identification.confidence !== "high") {
      notes.push(`Claude's confidence is ${identification.confidence}. Check the match before listing.`);
    }
    const payload: LookupResponse = { source: "photo", gtin, query, identification, results, notes };
    return Response.json(payload);
  } catch (err) {
    return errorResponse(err);
  }
}
