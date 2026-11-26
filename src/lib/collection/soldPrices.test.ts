import { describe, expect, it } from "vitest";
import type { PriceCheck } from "../../app/listing/priceRequest";
import type { PriceSuggestion } from "../pricing/suggestPrice";
import { checkKey } from "../sort/worth";
import { collectionCheckKey, collectionKeywords, priceChoices } from "./soldPrices";

function suggestion(quickSale: number, recommended: number, high: number, usedCount = 5): PriceSuggestion {
  return { itemPrice: { quickSale, recommended, high }, usedCount, currency: "CAD" } as PriceSuggestion;
}

function check(sold: PriceSuggestion | null, current: PriceSuggestion | null): PriceCheck {
  return { sold, current, soldItems: [], currentItems: [], unavailable: {}, keywords: "x" };
}

describe("collection sold prices", () => {
  it("searches by artist and album, sharing the Sort a pile cache key", () => {
    const item = { artist: "Genesis ", title: "Wind & Wuthering", barcode: "075678167523" };
    expect(collectionKeywords(item)).toBe("Genesis Wind & Wuthering");
    expect(collectionCheckKey(item)).toBe(checkKey("Genesis Wind & Wuthering", "075678167523"));
    expect(collectionCheckKey({ artist: "", title: "Abbey Road" })).toBe("abbey road");
  });

  it("offers quick sale, typical and high from the sold copies first", () => {
    const r = priceChoices(check(suggestion(8, 12.5, 18), suggestion(10, 15, 20)));
    expect(r?.from).toBe("sold");
    expect(r?.choices).toEqual([
      { label: "Quick sale", value: 8 },
      { label: "Typical sold", value: 12.5 },
      { label: "High", value: 18 },
    ]);
  });

  it("falls back to current listings when nothing sold, and drops repeated prices", () => {
    const r = priceChoices(check(suggestion(1, 1, 1, 0), suggestion(10, 10, 14)));
    expect(r?.from).toBe("listed");
    expect(r?.choices).toEqual([
      { label: "Quick sale", value: 10 },
      { label: "High", value: 14 },
    ]);
  });

  it("offers nothing when no copies were found", () => {
    expect(priceChoices(check(null, null))).toBeNull();
    expect(priceChoices(undefined)).toBeNull();
  });
});
