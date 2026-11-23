import { EbayApiError, getEbayClient, SCOPE_PUBLIC } from "@/lib/ebay";
import { errorResponse } from "@/lib/api-errors";
import { EMPTY_DETAILS, itemDetailsRequest, toItemDetails } from "@/lib/ebay/itemDetails";

/** GET /api/comparable?id=v1|123|0 (or a legacy item number) -> description, grades, origin. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const req = itemDetailsRequest(id);
  if (!req) return Response.json({ error: "Unknown item id" }, { status: 400 });
  try {
    const raw = await getEbayClient().get<unknown>(req.path, req.params, { scope: SCOPE_PUBLIC });
    return Response.json(toItemDetails(raw), { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    // Ended sales and removed listings: eBay answers 404 (or 400 for an old id).
    if (err instanceof EbayApiError && (err.status === 404 || err.status === 400 || err.status === 410)) {
      return Response.json(EMPTY_DETAILS);
    }
    return errorResponse(err);
  }
}
