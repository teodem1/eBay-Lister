import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { previewRefresh } from "@/lib/ebay/refreshListings";
import { albumByBarcode } from "@/lib/music/musicbrainz";
import { errorResponse, sellClient } from "../shared";

const Body = z.object({
  sku: z.string().min(1).max(50),
  /** From the price check saved on the phone: copies titled Canadian sold for more. */
  canadianVersion: z.boolean().optional(),
});

/** POST {sku}: Claude rewrites one live listing with the current rules. Nothing is sent to eBay. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the listing's sku." }, { status: 400 });
  const got = sellClient();
  if (got instanceof Response) return got;
  try {
    const preview = await previewRefresh(got.client, parsed.data.sku, {
      anthropic: new Anthropic(),
      config: got.config,
      albumFacts: (barcode) => albumByBarcode(barcode),
    }, { canadianVersion: parsed.data.canadianVersion });
    return Response.json(preview);
  } catch (err) {
    return errorResponse(err);
  }
}
