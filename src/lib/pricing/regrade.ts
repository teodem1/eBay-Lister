/**
 * Narrows a price check made before the CD was graded (Sort a pile, a scan with no
 * grades) to copies in the seller's condition, on the phone, from the sales and
 * listings it already holds. No new sold-comps lookup. Pure, for tests.
 */
import type { Comparable, ComparableSource } from "../ebay/types";
import type { Condition } from "../ebay/conditions";
import type { PriceCheck } from "./priceCheck";
import { suggestPrice, type PriceSuggestion } from "./suggestPrice";
import { sameCondition } from "./version";

function regradeSide(
  items: Comparable[],
  suggestion: PriceSuggestion | null,
  condition: Condition,
  keywords: string,
  unit: string,
  homeCountry: string,
): { items: Comparable[]; suggestion: PriceSuggestion | null } {
  const kept = sameCondition(items, condition);
  // Too few copies in that condition: sameCondition keeps them all, and so does the price.
  if (!suggestion || kept.length === items.length) return { items, suggestion };
  const source: ComparableSource = suggestion.source;
  const fresh = suggestPrice(
    { source, marketplaceId: `EBAY_${homeCountry}`, items: kept, notes: [], matchedBy: "keywords" },
    { activeListingDiscount: 0, homeCountry, keywords, unit },
  );
  return { items: kept, suggestion: fresh ?? suggestion };
}

/** The check in the seller's condition. A check already narrowed to a condition is returned as is. */
export function regradeCheck(check: PriceCheck, condition: Condition | undefined, homeCountry = "CA"): PriceCheck {
  if (!condition || check.condition) return check;
  const sold = regradeSide(check.soldItems, check.sold, condition, check.keywords, "sales", homeCountry);
  const current = regradeSide(check.currentItems, check.current, condition, check.keywords, "listings", homeCountry);
  return { ...check, sold: sold.suggestion, soldItems: sold.items, current: current.suggestion, currentItems: current.items, condition };
}
