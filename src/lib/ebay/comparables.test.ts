import { describe, expect, it, vi } from "vitest";
import { EbayClient, type FetchLike } from "./client";
import { buildEndUserCtx, buildFilter, findComparables } from "./comparables";

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
