import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import type { PriceCheck } from "./priceCheck";
import { regradeCheck } from "./regrade";
import { suggestPrice } from "./suggestPrice";

const c = (i: number, condition: string, value: number): Comparable =>
  ({
    itemId: `x${i}`,
    title: "U2 War CD",
    price: { value, currency: "CAD" },
    shippingCost: null,
    itemLocation: { country: "CA", postalCode: null },
    shippingDestination: "CA",
    condition,
    soldDate: "2026-11-01",
    quantitySold: 1,
    url: null,
  }) as unknown as Comparable;

const sealed = [c(1, "Brand New", 40), c(2, "Brand New", 42), c(3, "Brand New", 44)];
const used = [c(4, "Pre-Owned", 10), c(5, "Pre-Owned", 11), c(6, "Pre-Owned", 12)];
const all = [...sealed, ...used];
const suggestion = suggestPrice({ source: "sold_comps", marketplaceId: "EBAY_CA", items: all, notes: [] }, { activeListingDiscount: 0 });
const check: PriceCheck = {
  sold: suggestion,
  current: null,
  soldItems: all,
  currentItems: [],
  unavailable: {},
  keywords: "U2 War",
};

describe("regradeCheck", () => {
  it("prices an ungraded check from copies in the seller's condition, with no lookup", () => {
    const r = regradeCheck(check, "USED_VERY_GOOD");
    expect(r.condition).toBe("USED_VERY_GOOD");
    expect(r.soldItems).toHaveLength(3);
    expect(r.sold!.itemPrice.recommended).toBeLessThan(15);
    expect(regradeCheck(check, "NEW").sold!.itemPrice.recommended).toBeGreaterThan(35);
  });
  it("leaves a graded check, or no grade, alone", () => {
    expect(regradeCheck({ ...check, condition: "NEW" }, "USED_GOOD")).toEqual({ ...check, condition: "NEW" });
    expect(regradeCheck(check, undefined)).toBe(check);
  });
});
