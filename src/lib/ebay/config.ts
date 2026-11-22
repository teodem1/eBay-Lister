/** eBay environment config, read from environment variables only. */

export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  /** e.g. EBAY_CA, EBAY_US, EBAY_GB, EBAY_DE. */
  marketplaceId: string;
}

export function apiBaseUrl(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

export function loadEbayConfig(
  env: Record<string, string | undefined> = process.env,
): EbayConfig {
  const clientId = env.EBAY_CLIENT_ID;
  const clientSecret = env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set (see .env.example).",
    );
  }
  return {
    env: env.EBAY_ENV === "production" ? "production" : "sandbox",
    clientId,
    clientSecret,
    // Guillaume sells on eBay.ca. Override with EBAY_MARKETPLACE_ID.
    marketplaceId: env.EBAY_MARKETPLACE_ID || "EBAY_CA",
  };
}
