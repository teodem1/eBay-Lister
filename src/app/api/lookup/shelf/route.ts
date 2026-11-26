/**
 * POST /api/lookup/shelf (multipart form with an `image` file) -> { cds }
 *
 * Names every CD in one photo of several CDs side by side. Claude vision only:
 * no eBay and no sold-comps calls, so it costs none of the monthly sold-price
 * lookups. The phone prices the CDs the seller picks afterwards, one
 * /api/price-suggestion call each.
 */
import { errorResponse } from "@/lib/api-errors";
import { identifyShelf } from "@/lib/identify/shelf";
import type { ImageMediaType } from "@/lib/identify/vision";

const MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Claude accepts up to 5 MB per image; the page shrinks photos well below this.
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("image");
  } catch {
    return Response.json({ error: "Send a multipart form with an image field." }, { status: 400 });
  }
  if (!(file instanceof File)) return Response.json({ error: "No photo received." }, { status: 400 });
  if (!MEDIA_TYPES.includes(file.type as ImageMediaType)) {
    return Response.json({ error: `Unsupported image type: ${file.type || "unknown"}.` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) return Response.json({ error: "Photo is too large (max 5 MB)." }, { status: 413 });

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const cds = await identifyShelf(base64, file.type as ImageMediaType);
    return Response.json({ cds });
  } catch (err) {
    return errorResponse(err);
  }
}
