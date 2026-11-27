import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import { editionPrice } from "./edition";

const c = (title: string, value: number): Comparable => ({
  itemId: title + value,
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

const sold = [
  c("U2 War CD", 9),
  c("U2 War CD Island", 11),
  c("U2 War CD 1983 NO BARCODE early pressing", 24),
  c("U2 War no-barcode CD", 20),
  c("U2 War CD Canada", 14),
];

describe("editionPrice", () => {
  it("prices from sold copies of the same edition when they sold higher", () => {
    expect(editionPrice(sold, "no_barcode")).toEqual({
      edition: "no_barcode",
      price: 22,
      count: 2,
      low: 20,
      high: 24,
      reason: "2 no-barcode copies sold for $20.00-$24.00",
    });
    // 14 is under the typical other copy (15.50), so no Canadian price here.
    expect(editionPrice(sold, "canadian")).toBeNull();
    expect(editionPrice([c("X CD", 9), c("X CD", 10), c("X CD Canadian version", 16)], "canadian")?.price).toBe(16);
    expect(editionPrice(sold, "early_press")?.price).toBe(24);
  });
  it("doesn't count a Sony BMG label copy as a club edition", () => {
    const q = [c("Queen Greatest Hits CD", 10), c("Queen Greatest Hits CD Sony BMG", 12), c("Queen Greatest Hits CD BMG Direct club", 14)];
    expect(editionPrice(q, "club")).toMatchObject({ price: 14, count: 1 });
    expect(editionPrice([c("Queen CD", 10), c("Queen CD Sony BMG", 25)], "club")).toBeNull();
  });
  it("is null with no edition, no copies of it, or copies that sold for less", () => {
    expect(editionPrice(sold, "none")).toBeNull();
    expect(editionPrice(sold, "promo")).toBeNull();
    expect(editionPrice([c("X CD", 20), c("X CD", 22), c("X CD Canada", 8)], "canadian")).toBeNull();
    expect(editionPrice(undefined, "canadian")).toBeNull();
  });
});
