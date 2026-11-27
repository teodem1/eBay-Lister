import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import { canadianSoldForMore } from "./canadian";

const c = (title: string, value: number): Comparable => ({
  itemId: title,
  title,
  price: { value, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: null, postalCode: null },
  shippingDestination: null,
  condition: null,
  soldDate: null,
  quantitySold: 1,
  url: null,
});

describe("canadianSoldForMore", () => {
  it("is true when a copy titled Canadian sold above the typical other copy", () => {
    expect(canadianSoldForMore([c("CCR Best Of CD", 10), c("CCR Best Of CD", 12), c("CCR Best Of RARE CANADIAN VERSION", 25)])).toBe(true);
    expect(canadianSoldForMore([c("U2 War CD Canada", 15)])).toBe(true);
  });
  it("is false when no Canadian copy sold, or it sold for less", () => {
    expect(canadianSoldForMore([c("U2 War CD", 10), c("U2 War CD", 14)])).toBe(false);
    expect(canadianSoldForMore([c("U2 War CD", 10), c("U2 War CD", 14), c("U2 War CDN press", 9)])).toBe(false);
    expect(canadianSoldForMore(undefined)).toBe(false);
    // One Canadian copy just above the median among cheaper Canadian ones: the Canadian median is lower.
    expect(canadianSoldForMore([c("A CD Canada", 10.5), c("A CD Canada", 7), c("A CD Canada", 6), c("A CD", 8), c("A CD", 10)])).toBe(false);
  });
});
