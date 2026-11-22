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
  /** Promoted Listings Standard ad rate (% of the sale) applied to every new listing; 0 = off. */
  promotedPercent: number;
  /** Best Offer: lowest offer allowed, as % of the price (lower ones are declined); 0 = no Best Offer. */
  bestOfferMinPercent: number;
  /** Where the item ships from (inventory location). */
  location: {
    key: string;
    country: string;
    postalCode?: string;
    city?: string;
  };
}

// Defaults to eBay Canada (the seller uses ebay.ca). Override with EBAY_MARKETPLACE_ID etc.
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
  const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_CA";
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
    promotedPercent: parsePromotedPercent(env.EBAY_PROMOTED_PERCENT),
    bestOfferMinPercent: parseMinOfferPercent(env.EBAY_BEST_OFFER_MIN_PERCENT),
    location: {
      key: env.EBAY_LOCATION_KEY || "default-location",
      country: env.EBAY_LOCATION_COUNTRY || defaults.country,
      postalCode: env.EBAY_LOCATION_POSTAL_CODE || undefined,
      city: env.EBAY_LOCATION_CITY || undefined,
    },
  };
}

/** eBay accepts ad rates from 2% to 100%. Anything else (or unset) turns promotion off. */
export function parsePromotedPercent(value?: string): number {
  const n = Number(value?.replace("%", "").trim());
  return Number.isFinite(n) && n >= 2 && n <= 100 ? Math.round(n * 10) / 10 : 0;
}

/** 1 to 99 (% of the price); anything else (or unset) = 0, off. */
export function parseMinOfferPercent(value?: string): number {
  const n = Number(value?.replace("%", "").trim());
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 0;
}

/** eBay listing page for a published item, so the UI can link to it. */
const MARKETPLACE_HOSTS: Record<string, string> = {
  EBAY_CA: "www.ebay.ca",
  EBAY_US: "www.ebay.com",
  EBAY_GB: "www.ebay.co.uk",
  EBAY_FR: "www.ebay.fr",
  EBAY_DE: "www.ebay.de",
  EBAY_IT: "www.ebay.it",
  EBAY_ES: "www.ebay.es",
  EBAY_BE: "www.benl.ebay.be",
};

export function listingUrl(config: EbayConfig, listingId: string): string {
  const host =
    config.env === "production" ? (MARKETPLACE_HOSTS[config.marketplaceId] ?? "www.ebay.com") : "sandbox.ebay.com";
  return `https://${host}/itm/${listingId}`;
}

// ---------------------------------------------------------------------------
// App-token settings for the Browse API (item lookup). These need only the app
// keys, so lookup works before a seller account is connected.

/** Settings for the Browse API client (app token only). */
export interface BrowseConfig {
  clientId: string;
  clientSecret: string;
  env: EbayEnv;
  /** e.g. EBAY_CA, EBAY_US, EBAY_GB. Decides which site's listings we search. */
  marketplaceId: string;
}

export function apiBaseUrl(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

export function readEbayConfig(env: NodeJS.ProcessEnv = process.env): BrowseConfig {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new EbayConfigError(
      "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set (copy .env.example to .env).",
    );
  }
  const ebayEnv = env.EBAY_ENV?.trim() === "production" ? "production" : "sandbox";
  // The seller lists on eBay.ca.
  const marketplaceId = env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_CA";
  return { clientId, clientSecret, env: ebayEnv, marketplaceId };
}

export class EbayConfigError extends Error {
  name = "EbayConfigError";
}
