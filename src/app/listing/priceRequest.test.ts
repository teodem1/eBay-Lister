import { describe, expect, it, vi } from "vitest";
import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { defaultPrice, fetchPriceSuggestion, formatMoney, isGtin, priceSuggestionBody } from "./priceRequest";

describe("priceSuggestionBody", () => {
  it("sends a valid barcode as gtin together with keywords", () => {
    expect(priceSuggestionBody(" Switch OLED ", "0045496453435")).toEqual({
      keywords: "Switch OLED",
      gtin: "0045496453435",
    });
  });

  it("drops a barcode that is not a product GTIN", () => {
    expect(priceSuggestionBody("Switch OLED", "abc123")).toEqual({ keywords: "Switch OLED" });
    expect(isGtin("1234567")).toBe(false);
  });

  it("works from a barcode alone", () => {
    expect(priceSuggestionBody("", "012345678905")).toEqual({ gtin: "012345678905" });
  });

  it("returns null with nothing to search", () => {
    expect(priceSuggestionBody("  ", "")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats CAD", () => {
    expect(formatMoney(49.99, "CAD")).toMatch(/49\.99/);
  });

  it("falls back on an unknown currency code", () => {
    expect(formatMoney(5, "??")).toBe("5.00 ??");
  });
});

describe("fetchPriceSuggestion", () => {
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("posts the query and returns the suggestion", async () => {
    const f = ok({
      current: { suggestion: { currency: "CAD" }, comparables: { items: [{ itemId: "1" }] } },
      sold: null,
      unavailable: { sold: "not approved" },
    });
    const r = await fetchPriceSuggestion({ keywords: "x" }, f);
    expect(r).toEqual({
      current: { currency: "CAD" },
      sold: null,
      currentItems: [{ itemId: "1" }],
      soldItems: [],
      unavailable: { sold: "not approved" },
    });
    expect(f).toHaveBeenCalledWith("/api/price-suggestion", expect.objectContaining({ method: "POST" }));
  });

  it("returns the server error", async () => {
    expect(await fetchPriceSuggestion({ keywords: "x" }, ok({ error: "eBay down" }, 502))).toEqual({
      error: "eBay down",
    });
  });

  it("returns network errors instead of throwing", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchPriceSuggestion({ keywords: "x" }, f)).toEqual({ error: "offline" });
  });
});

describe("defaultPrice", () => {
  const s = (recommended: number, usedCount = 10) =>
    ({ usedCount, itemPrice: { quickSale: 1, recommended, high: 2 } }) as PriceSuggestion;

  it("prefers the last-sold price", () => {
    expect(defaultPrice({ current: s(300), sold: s(250), unavailable: {}, currentItems: [], soldItems: [] })).toBe(250);
  });

  it("falls back to the current price without sold data", () => {
    expect(defaultPrice({ current: s(300), sold: null, unavailable: {}, currentItems: [], soldItems: [] })).toBe(300);
    expect(defaultPrice({ current: s(300), sold: s(250, 0), unavailable: {}, currentItems: [], soldItems: [] })).toBe(300);
  });

  it("is undefined with no data", () => {
    expect(defaultPrice({ current: null, sold: null, unavailable: {}, currentItems: [], soldItems: [] })).toBeUndefined();
  });
});
