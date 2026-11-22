// eBay environment settings, read from env vars only (never hardcode keys).

export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  env: EbayEnv;
  apiBase: string;
  clientId?: string;
  clientSecret?: string;
  /** Long-lived user refresh token, used to mint user access tokens for the Sell APIs. */
  refreshToken?: string;
  /** Optional ready-made user access token (expires after ~2h). Handy for quick sandbox tests. */
  userToken?: string;
  marketplaceId: string;
  contentLanguage: string;
  currency: string;
  /** Business policies the offer needs. Create them once in the seller account. */
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  /** Where the item ships from (inventory location). */
  location: {
    key: string;
    country: string;
    postalCode?: string;
    city?: string;
  };
}

// GUESS: defaults assume a French seller. Override with EBAY_MARKETPLACE_ID etc.
const MARKETPLACE_DEFAULTS: Record<string, { language: string; currency: string; country: string }> = {
  EBAY_FR: { language: "fr-FR", currency: "EUR", country: "FR" },
  EBAY_US: { language: "en-US", currency: "USD", country: "US" },
  EBAY_GB: { language: "en-GB", currency: "GBP", country: "GB" },
  EBAY_DE: { language: "de-DE", currency: "EUR", country: "DE" },
  EBAY_IT: { language: "it-IT", currency: "EUR", country: "IT" },
  EBAY_ES: { language: "es-ES", currency: "EUR", country: "ES" },
  EBAY_BE: { language: "fr-BE", currency: "EUR", country: "BE" },
  EBAY_CA: { language: "en-CA", currency: "CAD", country: "CA" },
};

export function getEbayConfig(env: Record<string, string | undefined> = process.env): EbayConfig {
  const ebayEnv: EbayEnv = env.EBAY_ENV === "production" ? "production" : "sandbox";
  const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_FR";
  const defaults = MARKETPLACE_DEFAULTS[marketplaceId] ?? MARKETPLACE_DEFAULTS.EBAY_US;
  return {
    env: ebayEnv,
    apiBase: ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com",
    clientId: env.EBAY_CLIENT_ID || undefined,
    clientSecret: env.EBAY_CLIENT_SECRET || undefined,
    refreshToken: env.EBAY_REFRESH_TOKEN || undefined,
    userToken: env.EBAY_USER_TOKEN || undefined,
    marketplaceId,
    contentLanguage: env.EBAY_CONTENT_LANGUAGE || defaults.language,
    currency: env.EBAY_CURRENCY || defaults.currency,
    fulfillmentPolicyId: env.EBAY_FULFILLMENT_POLICY_ID || undefined,
    paymentPolicyId: env.EBAY_PAYMENT_POLICY_ID || undefined,
    returnPolicyId: env.EBAY_RETURN_POLICY_ID || undefined,
    location: {
      key: env.EBAY_LOCATION_KEY || "default-location",
      country: env.EBAY_LOCATION_COUNTRY || defaults.country,
      postalCode: env.EBAY_LOCATION_POSTAL_CODE || undefined,
      city: env.EBAY_LOCATION_CITY || undefined,
    },
  };
}

/** eBay listing page for a published item, so the UI can link to it. */
export function listingUrl(config: EbayConfig, listingId: string): string {
  const host = config.env === "production" ? "www.ebay.com" : "sandbox.ebay.com";
  return `https://${host}/itm/${listingId}`;
}
