import { z } from "zod";
import { getEbayConfig } from "@/lib/ebay/config";
import { applyCollectionEdit } from "@/lib/ebay/listingEdits";
import { EbayApiError, EbaySellClient } from "@/lib/ebay/sell";

const Fields = z.object({
  title: z.string().max(200),
  artist: z.string().max(200),
  year: z.number().int().optional(),
  price: z.number().min(0).max(100000).optional(),
});
const Body = z.object({
  sku: z.string().max(100).optional(),
  barcode: z.string().max(20).optional(),
  before: Fields,
  after: Fields,
});

/** POST a Collection edit (album, artist, year, price): updates the CD's live eBay listing. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid edit." }, { status: 400 });
  const config = getEbayConfig();
  if (!config.clientId || !config.clientSecret || (!config.refreshToken && !config.userToken)) {
    return Response.json({ error: "Server is missing eBay settings (EBAY_REFRESH_TOKEN)." }, { status: 500 });
  }
  try {
    const result = await applyCollectionEdit(new EbaySellClient(config), parsed.data, {
      bestOfferMinPercent: config.bestOfferMinPercent,
      currency: config.currency,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof EbayApiError) {
      return Response.json({ error: err.message, step: err.step }, { status: 502 });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
