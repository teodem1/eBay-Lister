/** A price check: sold and current prices for one CD, as the phone keeps it. */
import type { Comparable } from "../ebay/types";
import type { Condition } from "../ebay/conditions";
import type { PriceSuggestion } from "./suggestPrice";

export interface PriceCheck {
  /** From active eBay listings right now (asking prices). */
  current: PriceSuggestion | null;
  /** From items sold recently (SOLD_LOOKBACK_DAYS, default a year). */
  sold: PriceSuggestion | null;
  /** The listings behind each price, so the seller can compare them. */
  currentItems: Comparable[];
  soldItems: Comparable[];
  /** Why a price is missing, shown to the user. */
  unavailable: { current?: string; sold?: string };
  /** The item text the check searched for (decides which titles are other versions). */
  keywords: string;
  /** The sold-comps.com monthly allowance was used up, so there are no sold prices. */
  soldLimitReached?: boolean;
  /** sold-comps.com lookups left this period, when it says. */
  soldRemaining?: number;
  /**
   * The seller's eBay condition the check was narrowed to. Missing on a check made
   * before the CD was graded (Sort a pile, a scan with no grades): `regradeCheck`
   * narrows it on the phone, with no new lookup.
   */
  condition?: Condition;
}

/**
 * The prices to go by: last sold copies when any were used, else current listings.
 * Null when neither found any. Shared by the listing screen, Sort a pile and Collection.
 */
export function bestSuggestion(check: PriceCheck | undefined): { suggestion: PriceSuggestion; from: "sold" | "listed" } | null {
  if (!check) return null;
  const usable = (s: PriceSuggestion | null) => (s && s.usedCount > 0 ? s : null);
  const sold = usable(check.sold);
  if (sold) return { suggestion: sold, from: "sold" };
  const listed = usable(check.current);
  return listed ? { suggestion: listed, from: "listed" } : null;
}
