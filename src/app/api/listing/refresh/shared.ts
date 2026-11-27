import { getEbayConfig } from "@/lib/ebay/config";
import { EbayApiError, EbaySellClient } from "@/lib/ebay/sell";

/** The user-token eBay client, or a 500 response when the server lacks the eBay settings. */
export function sellClient(): { client: EbaySellClient; config: ReturnType<typeof getEbayConfig> } | Response {
  const config = getEbayConfig();
  if (!config.clientId || !config.clientSecret || (!config.refreshToken && !config.userToken)) {
    return Response.json({ error: "Server is missing eBay settings (EBAY_REFRESH_TOKEN)." }, { status: 500 });
  }
  return { client: new EbaySellClient(config), config };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof EbayApiError) {
    return Response.json({ error: err.message, step: err.step, details: err.body }, { status: 502 });
  }
  return Response.json({ error: (err as Error).message }, { status: 500 });
}
