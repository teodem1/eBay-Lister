import { listLiveListings } from "@/lib/ebay/refreshListings";
import { errorResponse, sellClient } from "./shared";

/** GET ?offset=0: one page of the seller's live listings (read only). */
export async function GET(request: Request) {
  const got = sellClient();
  if (got instanceof Response) return got;
  const offset = Math.max(0, Number(new URL(request.url).searchParams.get("offset")) || 0);
  try {
    return Response.json(await listLiveListings(got.client, offset));
  } catch (err) {
    return errorResponse(err);
  }
}
