/**
 * eBay settings, read from environment variables (see .env.example).
 * Server-only: never import this from a client component.
 */
export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  env: EbayEnv;
  /** e.g. EBAY_US, EBAY_FR, EBAY_GB. Decides which site's listings we search. */
  marketplaceId: string;
}

export function apiBaseUrl(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

export function readEbayConfig(env: NodeJS.ProcessEnv = process.env): EbayConfig {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayConfigError(
      "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set (copy .env.example to .env).",
    );
  }
  const ebayEnv = env.EBAY_ENV?.trim() === "production" ? "production" : "sandbox";
  // Guess: default to the US site until the seller's marketplace is confirmed.
  const marketplaceId = env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US";
  return { clientId, clientSecret, env: ebayEnv, marketplaceId };
}

export class EbayConfigError extends Error {
  name = "EbayConfigError";
}
