/** Shared types for eBay comparable-sales data. */

export interface Money {
  value: number;
  currency: string;
}

/**
 * One comparable listing used for pricing. Normalised from whichever eBay
 * API produced it, so the pricing logic does not care about the source.
 */
export interface Comparable {
  itemId: string;
  title: string;
  /** Item price (sold price for sold data, asking price for active data). */
  price: Money;
  /**
   * Cheapest shipping cost to the destination we asked about.
   * `null` when eBay did not return one (e.g. "calculated" shipping without a
   * destination, or local pickup only).
   */
  shippingCost: Money | null;
  /** Where the item ships from. */
  itemLocation: { country: string | null; postalCode: string | null };
  /**
   * The destination the shipping cost was quoted for. eBay does not expose
   * the actual buyer's country for a sale, so this is the destination we sent
   * in the request context, not where the item really went.
   */
  shippingDestination: string | null;
  condition: string | null;
  /** ISO date of the last sale. Only set for sold data. */
  soldDate: string | null;
  /** How many units sold (multi-quantity listings). Defaults to 1. */
  quantitySold: number;
  url: string | null;
}

/** Where the comparables came from. Drives how much we trust them. */
export type ComparableSource =
  /** Real sold prices from the Marketplace Insights API (restricted access). */
  | "marketplace_insights"
  /** Active asking prices from the Browse API (fallback, always available). */
  | "browse_active"
  /** Sold prices from the third-party sold-comps.com API (not eBay). */
  | "sold_comps";

export interface ComparableQuery {
  /** Free-text keywords, e.g. the identified product title. */
  keywords?: string;
  /** GTIN/UPC/EAN from a barcode scan. Preferred over keywords when present. */
  gtin?: string;
  /** eBay product id, if image/barcode matching already resolved one. */
  epid?: string;
  /** eBay category id to narrow results. */
  categoryId?: string;
  /** eBay condition ids, e.g. ["1000"] for New, ["3000"] for Used. */
  conditionIds?: string[];
  /** Country the buyer is in, ISO 3166 alpha-2 (e.g. "CA"). Used to quote shipping. */
  destinationCountry?: string;
  /** Postal code at the destination, for more accurate calculated shipping. */
  destinationPostalCode?: string;
  /** Only keep items located in these countries (ISO alpha-2). */
  itemLocationCountries?: string[];
  /** Max results to request (eBay caps at 200 per page). */
  limit?: number;
}

export interface ComparableResult {
  source: ComparableSource;
  marketplaceId: string;
  items: Comparable[];
  /** Human-readable notes about caveats in the data (shown to the user). */
  notes: string[];
}
