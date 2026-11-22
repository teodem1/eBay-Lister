import { describe, expect, it, vi } from "vitest";
import { buildSoldCompsUrl, countryCode, normaliseSoldCompsItem, searchSoldComps } from "./soldComps";

const opts = { apiKey: "sc_test", marketplaceId: "EBAY_CA", now: new Date("2026-11-22T00:00:00Z") };

describe("buildSoldCompsUrl", () => {
  it("searches ebay.ca for the last 90 days", () => {
    const u = new URL(buildSoldCompsUrl({ keywords: "Switch OLED", gtin: "0045496453435" }, opts));
    expect(u.origin + u.pathname).toBe("https://api.sold-comps.com/v1/scrape");
    expect(u.searchParams.get("keyword")).toBe("Switch OLED");
    expect(u.searchParams.get("ebaySite")).toBe("ebay.ca");
    expect(u.searchParams.get("soldAfter")).toBe("2026-08-24");
  });

  it("uses the barcode as keyword when there is no item text", () => {
    const u = new URL(buildSoldCompsUrl({ gtin: "0045496453435" }, opts));
    expect(u.searchParams.get("keyword")).toBe("0045496453435");
  });
});

describe("normaliseSoldCompsItem", () => {
  it("maps the provider fields to a comparable", () => {
    const c = normaliseSoldCompsItem(
      {
        itemId: 123,
        title: "Switch OLED",
        soldPrice: "379.99",
        soldCurrency: "CAD",
        shippingPrice: "15.00",
        shippingType: "paid",
        endedAt: "2026-11-10",
        itemLocation: "Toronto, Ontario, Canada",
        url: "https://www.ebay.ca/itm/123",
      },
      { destinationCountry: "CA" },
    );
    expect(c).toMatchObject({
      itemId: "123",
      price: { value: 379.99, currency: "CAD" },
      shippingCost: { value: 15, currency: "CAD" },
      itemLocation: { country: "CA" },
      shippingDestination: "CA",
      soldDate: "2026-11-10",
    });
  });

  it("treats free shipping as 0 and skips items without a price", () => {
    expect(
      normaliseSoldCompsItem({ itemId: "1", soldPrice: 10, soldCurrency: "CAD", shippingType: "free" }, {})
        ?.shippingCost,
    ).toEqual({ value: 0, currency: "CAD" });
    expect(normaliseSoldCompsItem({ itemId: "1" }, {})).toBeNull();
  });

  it("maps country names", () => {
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("Atlantis")).toBeNull();
  });
});

describe("searchSoldComps", () => {
  it("sends the key and returns comparables", async () => {
    const f = vi.fn(async () =>
      Response.json({ items: [{ itemId: "1", soldPrice: "20", soldCurrency: "CAD" }] }),
    );
    const items = await searchSoldComps({ keywords: "x" }, { ...opts, fetch: f });
    expect(items).toHaveLength(1);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sc_test");
  });

  it("throws with the status on an error", async () => {
    const f = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    await expect(searchSoldComps({ keywords: "x" }, { ...opts, fetch: f })).rejects.toThrow(/429/);
  });
});
