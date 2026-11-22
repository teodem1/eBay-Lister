import { getEbayConfig, listingUrl } from "@/lib/ebay/config";
import { publishListing } from "@/lib/ebay/publish";
import { EbayApiError, EbaySellClient } from "@/lib/ebay/sell";
import { ListingDraftSchema } from "@/lib/listing/types";

export async function POST(request: Request) {
  const parsed = ListingDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`);
    return Response.json({ error: "The listing is not complete.", problems }, { status: 400 });
  }

  const config = getEbayConfig();
  const missing = [
    !config.clientId && "EBAY_CLIENT_ID",
    !config.clientSecret && "EBAY_CLIENT_SECRET",
    !config.refreshToken && !config.userToken && "EBAY_REFRESH_TOKEN",
    !config.fulfillmentPolicyId && "EBAY_FULFILLMENT_POLICY_ID",
    !config.paymentPolicyId && "EBAY_PAYMENT_POLICY_ID",
    !config.returnPolicyId && "EBAY_RETURN_POLICY_ID",
    // eBay rejects a ship-from location without a postal code (error 25802).
    !config.location.postalCode && "EBAY_LOCATION_POSTAL_CODE",
  ].filter(Boolean);
  if (missing.length) {
    return Response.json({ error: `Server is missing eBay settings: ${missing.join(", ")}` }, { status: 500 });
  }

  try {
    const client = new EbaySellClient(config);
    const result = await publishListing(client, parsed.data, {
      bestOfferMinPercent: config.bestOfferMinPercent,
    });
    // The listing is live now, so a promotion failure is reported, not thrown.
    const percent = parsed.data.promotedPercent ?? config.promotedPercent;
    let promoted: { percent: number; campaignId: string } | null = null;
    let promotionError: string | undefined;
    if (percent >= 2) {
      try {
        promoted = { percent, ...(await client.promoteListing(result.listingId, percent)) };
      } catch (err) {
        promotionError = `Listed, but not promoted: ${(err as Error).message}`;
      }
    }
    return Response.json({
      ...result,
      env: config.env,
      url: listingUrl(config, result.listingId),
      promoted,
      promotionError,
    });
  } catch (err) {
    if (err instanceof EbayApiError) {
      return Response.json({ error: err.message, step: err.step, details: err.body }, { status: 502 });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
