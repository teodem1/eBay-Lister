import { describe, expect, it } from "vitest";
import { getEbayConfig } from "./config";
import { aspectsToEbay, barcodeIdentifiers, publishListing, reviseListing, withBrandAndMpn } from "./publish";
import { EbayApiError, EbaySellClient, nearestAllowedCondition, type FetchLike } from "./sell";
import type { ListingDraft } from "../listing/types";

const config = getEbayConfig({
  EBAY_CLIENT_ID: "id",
  EBAY_CLIENT_SECRET: "secret",
  EBAY_REFRESH_TOKEN: "refresh",
  EBAY_FULFILLMENT_POLICY_ID: "F1",
  EBAY_PAYMENT_POLICY_ID: "P1",
  EBAY_RETURN_POLICY_ID: "R1",
  EBAY_LOCATION_POSTAL_CODE: "M5V 2T6",
});

const draft: ListingDraft = {
  sku: "BC-123",
  title: "Nintendo Switch OLED Blanche 64 Go",
  categoryId: "139971",
  condition: "USED_VERY_GOOD",
  aspects: [
    { name: "Marque", value: "Nintendo", guessed: false },
    { name: "Couleur", value: "Blanc | Noir", guessed: true },
    { name: "Empty", value: " ", guessed: true },
  ],
  descriptionHtml: "<p>Console</p>",
  price: 249.9,
  quantity: 1,
  imageUrls: ["https://example.com/a.jpg"],
  packageWeightKg: 0.5,
  packageDimensionsCm: { length: 30, width: 20, height: 10 },
  barcode: "0045496453435",
};

type Call = { url: string; method: string; body?: unknown; headers: Record<string, string> };

/** Fake eBay that answers by "METHOD path" and records every call. */
function fakeEbay(routes: Record<string, (call: Call) => [number, unknown?]>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const call: Call = {
      url,
      method,
      body: typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ errors: [{ message: `no route ${method} ${path}` }] }), { status: 500 });
    const [status, body] = handler(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

const token = (): [number, unknown] => [200, { access_token: "USER", expires_in: 7200 }];

describe("publishListing", () => {
  it("runs location -> item -> offer -> publish and maps the draft", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [404, { errors: [] }],
      "POST /sell/inventory/v1/location/default-location": () => [204],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [404, {}],
      "POST /sell/inventory/v1/offer": () => [201, { offerId: "O1" }],
      "POST /sell/inventory/v1/offer/O1/publish": () => [200, { listingId: "L1" }],
    });

    const result = await publishListing(new EbaySellClient(config, fetchImpl), draft);
    expect(result).toEqual({ sku: "BC-123", offerId: "O1", listingId: "L1" });

    // Only one token mint, using the refresh token with the inventory scope.
    const tokenCalls = calls.filter((c) => c.url.includes("oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(String(tokenCalls[0].body)).toContain("grant_type=refresh_token");

    const item = calls.find((c) => c.method === "PUT")!;
    expect(item.headers["Content-Language"]).toBe("en-CA");
    expect(item.body).toMatchObject({
      condition: "USED_VERY_GOOD",
      packageWeightAndSize: {
        weight: { value: 0.5, unit: "KILOGRAM" },
        dimensions: { length: 30, width: 20, height: 10, unit: "CENTIMETER" },
      },
      product: {
        title: draft.title,
        aspects: { Marque: ["Nintendo"], Couleur: ["Blanc", "Noir"] },
        ean: ["0045496453435"],
      },
    });

    const offer = calls.find((c) => c.method === "POST" && c.url.endsWith("/offer"))!;
    expect(offer.body).toMatchObject({
      sku: "BC-123",
      marketplaceId: "EBAY_CA",
      format: "FIXED_PRICE",
      categoryId: "139971",
      merchantLocationKey: "default-location",
      pricingSummary: { price: { value: "249.90", currency: "CAD" } },
      listingPolicies: { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1" },
    });
  });

  it("reuses an existing location and offer so a retry does not fail", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [200, { offers: [{ offerId: "O9" }] }],
      "PUT /sell/inventory/v1/offer/O9": () => [204],
      "POST /sell/inventory/v1/offer/O9/publish": () => [200, { listingId: "L9" }],
    });
    const result = await publishListing(new EbaySellClient(config, fetchImpl), draft);
    expect(result.listingId).toBe("L9");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/location/default-location"))).toBe(false);
  });

  it("leaves Brand and MPN empty for a CD, and fills them if eBay asks (25002)", async () => {
    let publishes = 0;
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [200, { offers: [{ offerId: "O9" }] }],
      "PUT /sell/inventory/v1/offer/O9": () => [204],
      "POST /sell/inventory/v1/offer/O9/publish": () =>
        ++publishes === 1
          ? [400, { errors: [{ errorId: 25002, message: "A user error has occurred. Input data for tag <BrandMPN> is invalid or missing." }] }]
          : [200, { listingId: "L9" }],
    });
    const cd = {
      ...draft,
      title: "Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)",
      categoryName: "Music > CDs",
      brand: "Atlantic",
      mpn: "7567-82690-2",
      aspects: [
        { name: "Record Label", value: "Atlantic", guessed: false },
        { name: "MPN", value: "7567-82690-2", guessed: true },
      ],
    };
    const result = await publishListing(new EbaySellClient(config, fetchImpl), cd);
    expect(result.listingId).toBe("L9");
    const puts = calls.filter((c) => c.method === "PUT" && c.url.includes("inventory_item"));
    expect(puts).toHaveLength(2);
    const first = puts[0].body as { product: { aspects: Record<string, string[]>; brand?: string; mpn?: string } };
    expect(first.product.aspects).toEqual({ "Record Label": ["Atlantic"] });
    expect(first.product.brand).toBeUndefined();
    expect(first.product.mpn).toBeUndefined();
    const second = puts[1].body as { product: { aspects: Record<string, string[]>; brand?: string } };
    expect(second.product.aspects.Brand).toEqual(["Atlantic"]);
    expect(second.product.brand).toBe("Atlantic");
  });

  it("surfaces the eBay error message and failing step", async () => {
    const { fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [404, {}],
      "POST /sell/inventory/v1/offer": () => [201, { offerId: "O1" }],
      "POST /sell/inventory/v1/offer/O1/publish": () => [
        400,
        { errors: [{ errorId: 25002, longMessage: "Item specific Marque is missing" }] },
      ],
    });
    const err = await publishListing(new EbaySellClient(config, fetchImpl), draft).catch((e) => e);
    expect(err).toBeInstanceOf(EbayApiError);
    expect(err.step).toBe("publish offer");
    expect(err.message).toContain("Item specific Marque is missing");
  });

  it("uses EBAY_USER_TOKEN directly when there is no refresh token", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
    });
    const client = new EbaySellClient({ ...config, refreshToken: undefined, userToken: "DIRECT" }, fetchImpl);
    await client.ensureLocation();
    expect(calls[0].headers.Authorization).toBe("Bearer DIRECT");
  });

  it("sends an explicit Accept-Language (Node's default '*' is rejected by eBay)", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
    });
    await new EbaySellClient(config, fetchImpl).ensureLocation();
    expect(calls[1].headers["Accept-Language"]).toBe("en-CA");
  });

  it("prefers the refresh token over a leftover EBAY_USER_TOKEN", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
    });
    const client = new EbaySellClient({ ...config, userToken: "OLD-2H-TOKEN" }, fetchImpl);
    await client.ensureLocation();
    expect(calls[0].url).toContain("oauth2/token");
    expect(calls[1].headers.Authorization).not.toBe("Bearer OLD-2H-TOKEN");
  });
});

describe("helpers", () => {
  it("adds Brand and MPN item specifics when missing", () => {
    expect(withBrandAndMpn({ Color: ["Black"] }, "Nintendo")).toEqual({
      Color: ["Black"],
      Brand: ["Nintendo"],
      MPN: ["Does not apply"],
    });
    expect(withBrandAndMpn({ brand: ["Sony"], mpn: ["X1"] }, "Nintendo", "Y")).toEqual({ brand: ["Sony"], mpn: ["X1"] });
    // A CD with no brand: the record label, else "Unbranded", so the MPN never goes without a Brand.
    expect(withBrandAndMpn({ "Record Label": ["Atlantic"] })).toEqual({
      "Record Label": ["Atlantic"],
      Brand: ["Atlantic"],
      MPN: ["Does not apply"],
    });
    expect(withBrandAndMpn({})).toEqual({ Brand: ["Unbranded"], MPN: ["Does not apply"] });
  });

  it("picks the closest condition a category allows", () => {
    expect(nearestAllowedCondition("USED_GOOD", ["NEW", "USED_EXCELLENT"])).toBe("USED_EXCELLENT");
    expect(nearestAllowedCondition("USED_GOOD", [])).toBe("USED_GOOD");
    expect(nearestAllowedCondition("NEW_OTHER", ["NEW", "USED_EXCELLENT"])).toBe("NEW");
    expect(nearestAllowedCondition("FOR_PARTS_OR_NOT_WORKING", ["NEW"])).toBe("NEW");
  });

  it("reads condition policies from the Metadata API", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/metadata/v1/marketplace/EBAY_CA/get_item_condition_policies": () => [
        200,
        { itemConditionPolicies: [{ categoryId: "117042", itemConditions: [{ conditionId: "1000" }, { conditionId: "3000" }, { conditionId: "9999" }] }] },
      ],
    });
    const out = await new EbaySellClient(config, fetchImpl).getCategoryConditions(["117042", "139971"]);
    expect(out).toEqual({ "117042": ["NEW", "USED_EXCELLENT"] });
    expect(decodeURIComponent(calls[1].url)).toContain("filter=categoryIds:{117042|139971}");
  });

  it("drops empty aspects and splits multi-values", () => {
    expect(aspectsToEbay(draft.aspects)).toEqual({ Marque: ["Nintendo"], Couleur: ["Blanc", "Noir"] });
  });

  it("classifies barcodes", () => {
    expect(barcodeIdentifiers("045496453435")).toEqual({ upc: ["045496453435"] });
    expect(barcodeIdentifiers("4006381333931")).toEqual({ ean: ["4006381333931"] });
    expect(barcodeIdentifiers("abc")).toEqual({});
    expect(barcodeIdentifiers(undefined)).toEqual({});
  });
});

describe("promoted listings", () => {
  it("reuses this app's running campaign and adds the listing at the ad rate", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/marketing/v1/ad_campaign": () => [
        200,
        {
          campaigns: [
            { campaignId: "C1", campaignName: "eBay Lister - Standard 11.0%", campaignStatus: "ENDED", marketplaceId: "EBAY_CA" },
            { campaignId: "C2", campaignName: "eBay Lister - Standard 11.0%", campaignStatus: "RUNNING", marketplaceId: "EBAY_CA" },
          ],
        },
      ],
      "POST /sell/marketing/v1/ad_campaign/C2/ad": () => [201, {}],
    });
    const res = await new EbaySellClient(config, fetchImpl).promoteListing("L123", 11);

    expect(res).toEqual({ campaignId: "C2" });
    expect(String(calls[0].body)).toContain("sell.marketing");
    const ad = calls.find((c) => c.url.endsWith("/ad_campaign/C2/ad"))!;
    expect(ad.body).toEqual({ listingId: "L123", bidPercentage: "11.0" });
  });

  it("creates the cost-per-sale campaign when none exists", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/marketing/v1/ad_campaign": () => [200, { campaigns: [] }],
      "POST /sell/marketing/v1/ad_campaign/NEW9/ad": () => [201, {}],
    });
    const wrapped: FetchLike = async (url, init) => {
      if (init?.method === "POST" && url.endsWith("/sell/marketing/v1/ad_campaign")) {
        calls.push({ url, method: "POST", body: JSON.parse(String(init.body)), headers: {} });
        return new Response(null, { status: 201, headers: { Location: "https://api.ebay.com/sell/marketing/v1/ad_campaign/NEW9" } });
      }
      return fetchImpl(url, init);
    };
    const res = await new EbaySellClient(config, wrapped).promoteListing("L1", 11);

    expect(res.campaignId).toBe("NEW9");
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/ad_campaign"))!;
    expect(create.body).toMatchObject({
      campaignName: "eBay Lister - Standard 11.0%",
      marketplaceId: "EBAY_CA",
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "11.0" },
    });
  });

  it("explains a refresh token without the marketing scope", async () => {
    const { fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": () => [400, { error: "invalid_scope" }],
    });
    await expect(new EbaySellClient(config, fetchImpl).promoteListing("L1", 11)).rejects.toThrow(/api\/ebay\/connect/);
  });
});

describe("best offer", () => {
  it("enables Best Offer and declines offers under the minimum %, with no auto-accept", async () => {
    const { bestOfferTerms } = await import("./sell");
    expect(bestOfferTerms(14.99, 75, "CAD")).toEqual({
      bestOfferEnabled: true,
      autoDeclinePrice: { value: "11.24", currency: "CAD" },
    });
    expect(bestOfferTerms(14.99, 0, "CAD")).toBeUndefined();
    expect(bestOfferTerms(14.99, undefined, "CAD")).toBeUndefined();
  });

  it("sends bestOfferTerms on the offer from the server default", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [200, { offers: [] }],
      "POST /sell/inventory/v1/offer": () => [201, { offerId: "O1" }],
      "POST /sell/inventory/v1/offer/O1/publish": () => [200, { listingId: "L1" }],
    });
    await publishListing(new EbaySellClient(config, fetchImpl), draft, { bestOfferMinPercent: 75 });
    const offer = calls.find((c) => c.method === "POST" && c.url.endsWith("/offer"))!;
    expect(offer.body).toMatchObject({
      listingPolicies: { bestOfferTerms: { bestOfferEnabled: true, autoDeclinePrice: { value: "187.42", currency: "CAD" } } },
    });
  });
});

describe("reviseListing", () => {
  it("replaces the item and offer of a live listing without publishing again", async () => {
    const { calls, fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/location/default-location": () => [200, {}],
      "PUT /sell/inventory/v1/inventory_item/BC-123": () => [204],
      "GET /sell/inventory/v1/offer": () => [200, { offers: [{ offerId: "O9" }] }],
      "PUT /sell/inventory/v1/offer/O9": () => [204],
    });
    const result = await reviseListing(new EbaySellClient(config, fetchImpl), { ...draft, price: 12.5 });
    expect(result).toEqual({ sku: "BC-123", offerId: "O9" });
    const offer = calls.find((c) => c.method === "PUT" && c.url.endsWith("/offer/O9"))!;
    expect(offer.body).toMatchObject({ pricingSummary: { price: { value: "12.50" } } });
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
  });

  it("refuses when eBay has no offer for the SKU", async () => {
    const { fetchImpl } = fakeEbay({
      "POST /identity/v1/oauth2/token": token,
      "GET /sell/inventory/v1/offer": () => [404, {}],
    });
    await expect(reviseListing(new EbaySellClient(config, fetchImpl), draft)).rejects.toThrow(/nothing to revise/);
  });
});
