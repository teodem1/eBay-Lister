import { getEbayConfig } from "@/lib/ebay/config";
import { reviseListing } from "@/lib/ebay/publish";
import { EbayApiError, EbaySellClient } from "@/lib/ebay/sell";
import { ListingDraftSchema } from "@/lib/listing/types";

/** POST a full listing draft for a SKU that is already on eBay: updates the live listing. */
export async function POST(request: Request) {
  const parsed = ListingDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`);
    return Response.json({ error: "The listing is not complete.", problems }, { status: 400 });
  }
  const config = getEbayConfig();
  if (!config.clientId || !config.clientSecret || (!config.refreshToken && !config.userToken)) {
    return Response.json({ error: "Server is missing eBay settings (EBAY_REFRESH_TOKEN)." }, { status: 500 });
  }
  try {
    const result = await reviseListing(new EbaySellClient(config), parsed.data, {
      bestOfferMinPercent: config.bestOfferMinPercent,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof EbayApiError) {
      return Response.json({ error: err.message, step: err.step, details: err.body }, { status: 502 });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
