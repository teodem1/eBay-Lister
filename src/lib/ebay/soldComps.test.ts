import { describe, expect, it, vi } from "vitest";
import { buildSoldCompsUrl, countryCode, homeCountry, normaliseSoldCompsItem, searchSoldComps, soldLookbackDays } from "./soldComps";

const opts = { apiKey: "sc_test", marketplaceId: "EBAY_CA", now: new Date("2026-11-22T00:00:00Z") };

describe("buildSoldCompsUrl", () => {
  it("searches ebay.ca for the last year by default", () => {
    const u = new URL(buildSoldCompsUrl({ keywords: "Switch OLED", gtin: "0045496453435" }, opts));
    expect(u.origin + u.pathname).toBe("https://api.sold-comps.com/v1/scrape");
    expect(u.searchParams.get("keyword")).toBe("Switch OLED CD -vinyl -lp -cassette -tape -record");
    expect(u.searchParams.get("ebaySite")).toBe("ebay.ca");
    expect(u.searchParams.get("soldAfter")).toBe("2025-11-22");
  });

  it("honours a custom lookback", () => {
    const u = new URL(buildSoldCompsUrl({ keywords: "x" }, { ...opts, lookbackDays: 90 }));
    expect(u.searchParams.get("soldAfter")).toBe("2026-08-24");
    expect(soldLookbackDays("730")).toBe(730);
    expect(soldLookbackDays("5")).toBe(365);
    expect(soldLookbackDays(undefined)).toBe(365);
  });

  it("uses the barcode as keyword when there is no item text", () => {
    const u = new URL(buildSoldCompsUrl({ gtin: "0045496453435" }, opts));
    expect(u.searchParams.get("keyword")).toBe("045496453435");
  });

  it("searches the bare UPC when asked to", () => {
    const u = new URL(buildSoldCompsUrl({ keywords: "Genesis Wind & Wuthering", gtin: "075678269028" }, { ...opts, by: "barcode" }));
    expect(u.searchParams.get("keyword")).toBe("075678269028");
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

  it("parses an item as the live API returns it (ebay.ca, Nov 2026)", () => {
    const raw = {
      itemId: "168415872667",
      url: "https://www.ebay.ca/itm/168415872667?nordt=true",
      title: "Nintendo Switch OLED White With Satisfy Zen Grip And Case And A 200GB Micro SD",
      condition: "Pre-Owned",
      conditionId: 3000,
      listingType: "sold",
      endedAt: "2026-11-22",
      soldPrice: "286.88",
      soldPriceMax: null,
      soldCurrency: "CAD",
      shippingPrice: "113.96",
      shippingCurrency: "CAD",
      shippingType: "paid",
      totalPrice: "400.84",
      itemLocation: "United States",
    };
    expect(normaliseSoldCompsItem(raw, { destinationCountry: "CA" }, "CA")).toMatchObject({
      itemId: "168415872667",
      price: { value: 286.88, currency: "CAD" },
      shippingCost: { value: 113.96, currency: "CAD" },
      itemLocation: { country: "US" },
      soldDate: "2026-11-22",
      condition: "Pre-Owned",
    });
  });

  it("uses shippingCurrency when it differs from the sold currency", () => {
    const c = normaliseSoldCompsItem(
      { itemId: "1", soldPrice: "10", soldCurrency: "CAD", shippingPrice: "5", shippingCurrency: "USD" },
      {},
    );
    expect(c?.shippingCost).toEqual({ value: 5, currency: "USD" });
  });

  it("treats a missing location as the site's own country", () => {
    // Live free-shipping item from ebay.ca: no "from <country>" line, so it is domestic.
    const raw = {
      itemId: "137935301233",
      soldPrice: "247.05",
      soldCurrency: "CAD",
      shippingPrice: null,
      shippingCurrency: null,
      shippingType: "free",
      endedAt: "2026-11-20",
      itemLocation: null,
    };
    const c = normaliseSoldCompsItem(raw, {}, "CA");
    expect(c?.itemLocation.country).toBe("CA");
    expect(c?.shippingCost).toEqual({ value: 0, currency: "CAD" });
    expect(homeCountry("EBAY_CA")).toBe("CA");
    expect(homeCountry("EBAY_MOTORS")).toBeNull();
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

describe("findImageUrl", () => {
  it("finds the photo under any field name", async () => {
    const { findImageUrl } = await import("./soldComps");
    expect(findImageUrl({ imageUrl: "https://i.ebayimg.com/a/s-l225.jpg" })).toBe("https://i.ebayimg.com/a/s-l225.jpg");
    expect(findImageUrl({ url: "https://www.ebay.ca/itm/1", photos: ["https://i.ebayimg.com/images/g/x/s-l500.webp"] })).toBe(
      "https://i.ebayimg.com/images/g/x/s-l500.webp",
    );
    expect(findImageUrl({ url: "https://www.ebay.ca/itm/1", title: "CD" })).toBeNull();
  });
});
