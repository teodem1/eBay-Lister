import { describe, expect, it, vi } from "vitest";
import { EbayClient, type FetchLike } from "./client";
import { buildEndUserCtx, buildFilter, findBothComparables, findComparables } from "./comparables";

const config = {
  env: "sandbox" as const,
  clientId: "id",
  clientSecret: "secret",
  marketplaceId: "EBAY_CA",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const soldItem = {
  itemId: "v1|1|0",
  title: "Nintendo Switch OLED",
  lastSoldPrice: { value: "250.00", currency: "CAD" },
  lastSoldDate: "2026-11-01T10:00:00.000Z",
  totalSoldQuantity: 2,
  condition: "Used",
  itemLocation: { country: "CA", postalCode: "M5V" },
  shippingOptions: [
    { shippingCost: { value: "9.99", currency: "CAD" } },
    { shippingCost: { value: "6.50", currency: "CAD" } },
  ],
  itemWebUrl: "https://www.ebay.ca/itm/1",
};

describe("request building", () => {
  it("builds the filter and end-user context", () => {
    const q = { conditionIds: ["1000", "3000"], itemLocationCountries: ["CA"], destinationCountry: "CA" };
    expect(buildFilter(q)).toBe("conditionIds:{1000|3000},itemLocationCountry:CA,deliveryCountry:CA");
    expect(buildEndUserCtx({ destinationCountry: "CA", destinationPostalCode: "M5V3L9" })).toBe(
      "contextualLocation=country%3DCA%2Czip%3DM5V3L9",
    );
  });
});

describe("findComparables", () => {
  it("uses Marketplace Insights when the app has access", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/token")) return json(200, { access_token: "t", expires_in: 7200 });
      if (u.includes("marketplace_insights")) return json(200, { itemSales: [soldItem] });
      throw new Error("unexpected " + u);
    });
    const res = await findComparables(new EbayClient(config, fetchMock), {
      gtin: "0045496453435",
      keywords: "ignored when gtin set",
      destinationCountry: "CA",
    });

    expect(res.source).toBe("marketplace_insights");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      price: { value: 250, currency: "CAD" },
      shippingCost: { value: 6.5, currency: "CAD" },
      itemLocation: { country: "CA", postalCode: "M5V" },
      shippingDestination: "CA",
      quantitySold: 2,
    });
    const searchUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(searchUrl.searchParams.get("gtin")).toBe("0045496453435");
    expect(searchUrl.searchParams.get("q")).toBeNull();
    const headers = fetchMock.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_CA");
  });

  it("falls back to Browse active listings when Insights scope is refused", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const u = String(_url);
      if (u.includes("oauth2/token")) {
        const scope = new URLSearchParams(String(init?.body)).get("scope")!;
        return scope.endsWith("buy.marketplace.insights")
          ? json(400, { error: "invalid_scope" })
          : json(200, { access_token: "t", expires_in: 7200 });
      }
      if (u.includes("/buy/browse/")) {
        return json(200, {
          itemSummaries: [{ ...soldItem, lastSoldPrice: undefined, price: { value: "280.00", currency: "CAD" } }],
        });
      }
      throw new Error("unexpected " + u);
    });
    const res = await findComparables(new EbayClient(config, fetchMock), { keywords: "switch oled" });

    expect(res.source).toBe("browse_active");
    expect(res.items[0].price.value).toBe(280);
    expect(res.items[0].soldDate).toBeNull();
    expect(res.notes[0]).toMatch(/asking prices/);
  });

  it("rethrows errors that are not access problems", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) =>
      String(url).includes("oauth2/token")
        ? json(200, { access_token: "t", expires_in: 7200 })
        : json(500, { errors: [] }),
    );
    await expect(
      findComparables(new EbayClient(config, fetchMock), { keywords: "x" }),
    ).rejects.toThrow(/500/);
  });
});

describe("findBothComparables", () => {
  const activeItem = { ...soldItem, lastSoldPrice: undefined, price: { value: "280.00", currency: "CAD" } };

  it("returns current and sold results side by side", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/token")) return json(200, { access_token: "t", expires_in: 7200 });
      if (u.includes("marketplace_insights")) return json(200, { itemSales: [soldItem] });
      if (u.includes("/buy/browse/")) return json(200, { itemSummaries: [activeItem] });
      throw new Error("unexpected " + u);
    });
    const res = await findBothComparables(new EbayClient(config, fetchMock), { keywords: "switch oled" });

    expect(res.current?.source).toBe("browse_active");
    expect(res.current?.items[0].price.value).toBe(280);
    expect(res.sold?.source).toBe("marketplace_insights");
    expect(res.sold?.items[0].price.value).toBe(250);
    expect(res.unavailable).toEqual({});
  });

  it("keeps the current price and explains why sold prices are missing", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/token")) {
        const scope = new URLSearchParams(String(init?.body)).get("scope")!;
        return scope.endsWith("buy.marketplace.insights")
          ? json(400, { error: "invalid_scope" })
          : json(200, { access_token: "t", expires_in: 7200 });
      }
      if (u.includes("/buy/browse/")) return json(200, { itemSummaries: [activeItem] });
      throw new Error("unexpected " + u);
    });
    const res = await findBothComparables(new EbayClient(config, fetchMock), { keywords: "x" });

    expect(res.current?.items).toHaveLength(1);
    expect(res.sold).toBeNull();
    expect(res.unavailable.sold).toMatch(/Marketplace Insights/);
  });

  it("uses sold-comps.com for sold prices when Insights is refused and a key is set", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/token")) {
        const scope = new URLSearchParams(String(init?.body)).get("scope")!;
        return scope.endsWith("buy.marketplace.insights")
          ? json(400, { error: "invalid_scope" })
          : json(200, { access_token: "t", expires_in: 7200 });
      }
      if (u.includes("/buy/browse/")) return json(200, { itemSummaries: [activeItem] });
      throw new Error("unexpected " + u);
    });
    const soldCompsFetch = vi.fn(async () =>
      json(200, { items: [{ itemId: "9", soldPrice: "240.00", soldCurrency: "CAD", endedAt: "2026-11-01" }] }),
    );
    const res = await findBothComparables(
      new EbayClient(config, fetchMock),
      { keywords: "switch oled" },
      { soldCompsApiKey: "sc_test", soldCompsFetch },
    );

    expect(res.sold?.source).toBe("sold_comps");
    expect(res.sold?.items[0].price.value).toBe(240);
    expect(res.sold?.notes[0]).toMatch(/third-party/);
    expect(res.unavailable).toEqual({});
  });

  it("falls back to sold-comps.com when the Insights search itself fails (sandbox 400)", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/token")) return json(200, { access_token: "t", expires_in: 7200 });
      if (u.includes("/buy/marketplace_insights/")) return json(400, { errors: [{ errorId: 12000 }] });
      if (u.includes("/buy/browse/")) return json(200, { itemSummaries: [activeItem] });
      throw new Error("unexpected " + u);
    });
    const soldCompsFetch = vi.fn(async () =>
      json(200, { items: [{ itemId: "9", soldPrice: "240.00", soldCurrency: "CAD", endedAt: "2026-11-01" }] }),
    );
    const res = await findBothComparables(
      new EbayClient(config, fetchMock),
      { keywords: "switch oled" },
      { soldCompsApiKey: "sc_test", soldCompsFetch },
    );

    expect(res.sold?.source).toBe("sold_comps");
    expect(res.unavailable).toEqual({});
  });

  it("throws only when both searches fail", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) =>
      String(url).includes("oauth2/token")
        ? json(200, { access_token: "t", expires_in: 7200 })
        : json(500, { errors: [] }),
    );
    await expect(findBothComparables(new EbayClient(config, fetchMock), { keywords: "x" })).rejects.toThrow(/500/);
  });

  describe("with a barcode", () => {
    const ebayFetch = (browseCount: number) =>
      vi.fn<FetchLike>(async (url) => {
        const u = String(url);
        if (u.includes("oauth2/token")) return json(200, { access_token: "t", expires_in: 7200 });
        if (u.includes("/buy/marketplace_insights/")) return json(403, { errors: [{ errorId: 1100 }] });
        if (u.includes("/buy/browse/")) {
          const byBarcode = new URL(u).searchParams.has("gtin");
          return json(200, { itemSummaries: Array(byBarcode ? browseCount : 5).fill(activeItem) });
        }
        throw new Error("unexpected " + u);
      });
    const sale = (id: string) => ({ itemId: id, soldPrice: "15.00", soldCurrency: "CAD", endedAt: "2026-11-01" });
    const q = { keywords: "Genesis Wind & Wuthering", gtin: "075678269028" };

    it("prices the exact pressing from barcode matches", async () => {
      const soldCompsFetch = vi.fn<(url: string) => Promise<Response>>(async () => json(200, { items: [sale("1"), sale("2"), sale("3")] }));
      const res = await findBothComparables(new EbayClient(config, ebayFetch(4)), q, {
        soldCompsApiKey: "sc_test",
        soldCompsFetch,
      });
      expect(soldCompsFetch).toHaveBeenCalledTimes(1);
      expect(new URL(String(soldCompsFetch.mock.calls[0][0])).searchParams.get("keyword")).toBe("UPC075678269028");
      expect(res.sold?.matchedBy).toBe("barcode");
      expect(res.current?.matchedBy).toBe("barcode");
    });

    it("searches by name when too few sales carry the barcode", async () => {
      const soldCompsFetch = vi
        .fn()
        .mockResolvedValueOnce(json(200, { items: [sale("1")] }))
        .mockResolvedValueOnce(json(200, { items: [sale("1"), sale("2"), sale("3"), sale("4")] }));
      const res = await findBothComparables(new EbayClient(config, ebayFetch(0)), q, {
        soldCompsApiKey: "sc_test",
        soldCompsFetch,
      });
      expect(soldCompsFetch).toHaveBeenCalledTimes(2);
      expect(new URL(String(soldCompsFetch.mock.calls[1][0])).searchParams.get("keyword")).toBe("Genesis Wind & Wuthering");
      expect(res.sold?.matchedBy).toBe("keywords");
      expect(res.sold?.items).toHaveLength(4);
      expect(res.current?.items).toHaveLength(5);
      expect(res.current?.matchedBy).toBe("keywords");
    });
  });
});
