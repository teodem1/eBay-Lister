import { describe, expect, it } from "vitest";
import type { Comparable, ComparableResult } from "../ebay/types";
import { charmPrice, removeOutliers, suggestPrice } from "./suggestPrice";

function comp(price: number, ship: number | null, over: Partial<Comparable> = {}): Comparable {
  return {
    itemId: `${price}-${ship}-${Math.random()}`,
    title: "x",
    price: { value: price, currency: "CAD" },
    shippingCost: ship === null ? null : { value: ship, currency: "CAD" },
    itemLocation: { country: "CA", postalCode: null },
    shippingDestination: "CA",
    condition: "Used",
    soldDate: "2026-11-20T00:00:00Z",
    quantitySold: 1,
    url: null,
    ...over,
  };
}

const now = new Date("2026-11-22T00:00:00Z");

describe("charmPrice", () => {
  it("ends prices in .99", () => {
    expect(charmPrice(23.7)).toBe(23.99);
    expect(charmPrice(23.2)).toBe(22.99);
    expect(charmPrice(0.5)).toBe(0.5);
  });
});

describe("removeOutliers", () => {
  it("drops extreme totals", () => {
    const items = [20, 21, 22, 23, 24, 25, 500].map((p) => comp(p, 0));
    expect(removeOutliers(items).map((c) => c.price.value)).not.toContain(500);
  });
});

describe("suggestPrice", () => {
  const sold: ComparableResult = {
    source: "marketplace_insights",
    marketplaceId: "EBAY_CA",
    notes: [],
    items: [
      ...[40, 42, 44, 45, 46, 48, 50].map((p) => comp(p, 5)),
      comp(45, 5, { itemLocation: { country: "DE", postalCode: null } }),
      comp(1, 5), // broken item, outlier
    ],
  };

  it("suggests prices from sold totals minus shipping", () => {
    const s = suggestPrice(sold, { now })!;
    expect(s.outliersRemoved).toBe(1);
    expect(s.assumedShipping).toBe(5);
    expect(s.totals.median).toBe(50);
    // recommended total ≈ 50 → item ≈ 45 → charm → 44.99
    expect(s.itemPrice.recommended).toBe(44.99);
    expect(s.itemPrice.quickSale).toBeLessThanOrEqual(s.itemPrice.recommended);
    expect(s.itemPrice.high).toBeGreaterThanOrEqual(s.itemPrice.recommended);
    expect(s.byOrigin.find((o) => o.country === "DE")?.count).toBe(1);
    expect(s.shippingDestination).toBe("CA");
  });

  it("uses the seller's own shipping cost when given", () => {
    const s = suggestPrice(sold, { now, myShippingCost: 0 })!;
    expect(s.itemPrice.recommended).toBe(49.99);
  });

  it("discounts active asking prices and caps confidence", () => {
    const active: ComparableResult = {
      ...sold,
      source: "browse_active",
      items: sold.items.map((c) => ({ ...c, soldDate: null })),
    };
    const s = suggestPrice(active, { now, myShippingCost: 0 })!;
    // 50 * 0.85 = 42.5 → 42.99
    expect(s.itemPrice.recommended).toBe(42.99);
    expect(s.confidence).not.toBe("high");
  });

  it("skips other currencies and returns null with no data", () => {
    const mixed: ComparableResult = {
      ...sold,
      items: [...sold.items, comp(30, 2, { price: { value: 30, currency: "GBP" } })],
    };
    expect(suggestPrice(mixed, { now })!.otherCurrencySkipped).toBe(1);
    expect(suggestPrice({ ...sold, items: [] })).toBeNull();
  });

  it("counts missing shipping as free and says so", () => {
    const s = suggestPrice({ ...sold, items: [comp(30, null), comp(32, 4)] }, { now })!;
    expect(s.notes.some((n) => n.includes("free shipping"))).toBe(true);
  });
});
