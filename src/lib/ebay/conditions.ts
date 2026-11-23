// eBay's item conditions and their closest substitutes. No client code here, so
// screens can import it without pulling the Sell API client into the browser.

/** eBay condition enums accepted by the Inventory API. */
export const CONDITIONS = [
  "NEW",
  "LIKE_NEW",
  "NEW_OTHER",
  "NEW_WITH_DEFECTS",
  "CERTIFIED_REFURBISHED",
  "EXCELLENT_REFURBISHED",
  "VERY_GOOD_REFURBISHED",
  "GOOD_REFURBISHED",
  "SELLER_REFURBISHED",
  "USED_EXCELLENT",
  "USED_VERY_GOOD",
  "USED_GOOD",
  "USED_ACCEPTABLE",
  "FOR_PARTS_OR_NOT_WORKING",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** eBay's numeric condition IDs (Metadata API) for each Inventory API condition enum. */
export const CONDITION_IDS: Record<Condition, string> = {
  NEW: "1000",
  LIKE_NEW: "2750",
  NEW_OTHER: "1500",
  NEW_WITH_DEFECTS: "1750",
  CERTIFIED_REFURBISHED: "2000",
  EXCELLENT_REFURBISHED: "2010",
  VERY_GOOD_REFURBISHED: "2020",
  GOOD_REFURBISHED: "2030",
  SELLER_REFURBISHED: "2500",
  USED_EXCELLENT: "3000",
  USED_VERY_GOOD: "4000",
  USED_GOOD: "5000",
  USED_ACCEPTABLE: "6000",
  FOR_PARTS_OR_NOT_WORKING: "7000",
};

// Closest substitutes, best first, when a category doesn't accept a condition.
const CONDITION_FALLBACKS: Partial<Record<Condition, Condition[]>> = {
  USED_VERY_GOOD: ["USED_EXCELLENT", "USED_GOOD"],
  USED_GOOD: ["USED_EXCELLENT", "USED_VERY_GOOD", "USED_ACCEPTABLE"],
  USED_ACCEPTABLE: ["USED_GOOD", "USED_EXCELLENT"],
  USED_EXCELLENT: ["USED_VERY_GOOD", "USED_GOOD", "LIKE_NEW"],
  LIKE_NEW: ["NEW_OTHER", "USED_EXCELLENT"],
  NEW_OTHER: ["NEW", "LIKE_NEW"],
  NEW_WITH_DEFECTS: ["NEW_OTHER", "NEW"],
  EXCELLENT_REFURBISHED: ["SELLER_REFURBISHED", "VERY_GOOD_REFURBISHED"],
  VERY_GOOD_REFURBISHED: ["SELLER_REFURBISHED", "GOOD_REFURBISHED"],
  GOOD_REFURBISHED: ["SELLER_REFURBISHED", "VERY_GOOD_REFURBISHED"],
  CERTIFIED_REFURBISHED: ["SELLER_REFURBISHED"],
};

/** The condition itself if the category allows it, else its closest allowed substitute. */
export function nearestAllowedCondition(condition: Condition, allowed: readonly Condition[]): Condition {
  if (!allowed.length || allowed.includes(condition)) return condition;
  for (const c of CONDITION_FALLBACKS[condition] ?? []) if (allowed.includes(c)) return c;
  if (condition.startsWith("USED")) {
    const used = allowed.find((c) => c.startsWith("USED"));
    if (used) return used;
  }
  return allowed[0];
}
