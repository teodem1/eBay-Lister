/* eslint-disable @typescript-eslint/no-explicit-any */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { getEbayConfig } from "./config";
import type { EbaySellClient } from "./sell";
import {
  applyRefresh,
  listLiveListings,
  mergeAspects,
  previewRefresh,
  queryFromListing,
  sellerConditionFromListing,
} from "./refreshListings";

const item = {
  sku: "BC-075678154323-ABCDE",
  condition: "LIKE_NEW",
  conditionDescription: "Disc: near mint. Inlay / booklet: near mint. Case: good. Tested: plays through without skips. Small crack on the case hinge.",
  availability: { shipToLocationAvailability: { quantity: 1 } },
  product: {
    title: "Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)",
    description: "<p>old</p>",
    aspects: { Artist: ["Genesis"], "Release Title": ["Wind & Wuthering"], Format: ["CD"] },
    imageUrls: ["https://i.ebayimg.com/a.jpg"],
    upc: ["075678154323"],
  },
};
const offer = {
  offerId: "O1",
  sku: item.sku,
  status: "PUBLISHED",
  categoryId: "176984",
  listing: { listingId: "366831191940" },
  listingDescription: "<p>old</p>",
  pricingSummary: { price: { value: "17.50", currency: "CAD" } },
  listingPolicies: { fulfillmentPolicyId: "F", bestOfferTerms: { bestOfferEnabled: true, autoDeclinePrice: { value: "12.25" } } },
};

function fakeClient(over: Partial<Record<keyof EbaySellClient, unknown>> = {}) {
  return {
    getInventoryItemRaw: vi.fn().mockResolvedValue(structuredClone(item)),
    getOffersRaw: vi.fn().mockResolvedValue([structuredClone(offer)]),
    putInventoryItemRaw: vi.fn().mockResolvedValue(undefined),
    putOfferRaw: vi.fn().mockResolvedValue(undefined),
    listInventoryItems: vi.fn(),
    getCategoryTreeId: vi.fn().mockResolvedValue("2"),
    suggestCategories: vi.fn().mockResolvedValue([]),
    getCategoryAspects: vi.fn().mockResolvedValue([]),
    getCategoryConditions: vi.fn().mockResolvedValue({}),
    ...over,
  } as unknown as EbaySellClient;
}

describe("sellerConditionFromListing", () => {
  it("reads the grades back from the condition text the app wrote", () => {
    expect(sellerConditionFromListing(item)).toEqual({
      condition: "LIKE_NEW",
      disc: "Near mint",
      booklet: "Near mint",
      case: "Good",
      tested: true,
      notes: "Small crack on the case hinge.",
    });
  });
  it("falls back to the title, handles sealed and refuses an ungraded listing", () => {
    expect(
      sellerConditionFromListing({ condition: "USED_VERY_GOOD", product: { title: "X Y CD (Disc: Very Good+ / Inlay: Missing)" } }),
    ).toEqual({ condition: "USED_VERY_GOOD", disc: "Very good+", booklet: "Missing" });
    expect(sellerConditionFromListing({ condition: "NEW", conditionDescription: "New, factory sealed.", product: { title: "X CD (Sealed)" } })).toEqual({
      condition: "NEW",
    });
    expect(sellerConditionFromListing({ condition: "USED_GOOD", product: { title: "Some CD" } })).toBeUndefined();
  });
});

describe("queryFromListing", () => {
  it("uses artist and album, else the title without the grades", () => {
    expect(queryFromListing(item)).toBe("Genesis Wind & Wuthering");
    expect(queryFromListing({ product: { title: "Rush Moving Pictures CD (Disc: Mint / Inlay: Mint)" } })).toBe("Rush Moving Pictures");
  });
});

describe("mergeAspects", () => {
  it("only adds missing certain values; never changes old ones, flags disagreements", () => {
    const { aspects, changed, conflicts } = mergeAspects(
      { Artist: ["Genesis"], Format: ["CD"], Style: ["Pop Rock"], "Release Year": ["1983"], "Catalogue Number": ["SD 36-144"] },
      [
        { name: "artist", value: "Genesis", guessed: false },
        { name: "Record Label", value: "Atlantic", guessed: false },
        { name: "Genre", value: "Rock | Prog Rock", guessed: false },
        { name: "Style", value: "1980s", guessed: false },
        { name: "Release Year", value: "1977", guessed: false },
        { name: "Catalog Number", value: "SD 36-144", guessed: false },
        { name: "Edition", value: "Remastered", guessed: true },
        { name: "Brand", value: "Atlantic", guessed: false },
        { name: "Unit Type", value: "Unit", guessed: false },
        { name: "Language", value: "", guessed: true },
      ],
    );
    expect(aspects).toEqual({
      Artist: ["Genesis"],
      Format: ["CD"],
      Style: ["Pop Rock"],
      "Release Year": ["1983"],
      "Catalogue Number": ["SD 36-144"],
      "Record Label": ["Atlantic"],
      Genre: ["Rock", "Prog Rock"],
    });
    expect(changed).toEqual(["Record Label", "Genre"]);
    expect(conflicts).toEqual(["Release Year: listing says 1983, Claude says 1977"]);
  });
});

describe("listLiveListings", () => {
  it("keeps only items with a published offer", async () => {
    const client = fakeClient({
      listInventoryItems: vi.fn().mockResolvedValue({ items: [item, { ...item, sku: "SOLD-1" }], total: 2 }),
      getOffersRaw: vi.fn(async (sku: string) => (sku === "SOLD-1" ? [{ ...offer, status: "UNPUBLISHED" }] : [offer])),
    });
    const out = await listLiveListings(client, 0, 50);
    expect(out.listings).toEqual([
      { sku: item.sku, listingId: "366831191940", title: item.product.title, price: 17.5, imageUrl: "https://i.ebayimg.com/a.jpg" },
    ]);
    expect(out.nextOffset).toBeUndefined();
  });
});

describe("previewRefresh", () => {
  it("rewrites from what eBay has and sends nothing to eBay", async () => {
    const parse = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        title: "Genesis Wind & Wuthering",
        titleExtras: ["1977"],
        condition: "USED_GOOD",
        conditionDescription: "",
        brand: "",
        mpn: "",
        aspects: [{ name: "Release Year", value: "1977", guessed: false }],
        descriptionHtml: "<p>Genesis Wind &amp; Wuthering on CD.</p>",
        guessedFields: [],
        checks: ["Confirm the catalog number"],
        price: 0,
        priceReason: "",
        discCount: 1,
        doubleJewelCase: false,
      },
    });
    const client = fakeClient();
    const p = await previewRefresh(client, item.sku, {
      anthropic: { beta: { messages: { parse } } } as unknown as Anthropic,
      config: getEbayConfig({}),
    });
    expect(p.before.title).toBe(item.product.title);
    expect(p.after.title).toBe("Genesis Wind & Wuthering 1977 CD (Disc: Near Mint / Inlay: Near Mint)");
    expect(p.after.aspects["Release Year"]).toEqual(["1977"]);
    expect(p.after.aspects.Artist).toEqual(["Genesis"]);
    expect(p.changedAspects).toEqual(["Release Year"]);
    expect(p.checks).toEqual(["Confirm the catalog number"]);
    const text = parse.mock.calls[0][0].messages[0].content as string;
    expect(text).toContain("Item: Genesis Wind & Wuthering");
    expect(text).toContain("Barcode (EAN/UPC): 075678154323");
    expect(text).toContain("Small crack on the case hinge.");
    expect(client.suggestCategories).not.toHaveBeenCalled();
    expect(client.putInventoryItemRaw).not.toHaveBeenCalled();
    expect(client.putOfferRaw).not.toHaveBeenCalled();
  });
});

describe("applyRefresh", () => {
  const after = { title: "Genesis Wind & Wuthering 1977 CD (Disc: Near Mint / Inlay: Near Mint)", aspects: { Artist: ["Genesis"] }, descriptionHtml: "<p>new</p>" };

  it("changes only title, item specifics and description", async () => {
    const client = fakeClient();
    expect(await applyRefresh(client, item.sku, item.product.title, after)).toEqual({
      status: "updated",
      sku: item.sku,
      listingId: "366831191940",
    });
    const putItem = vi.mocked(client.putInventoryItemRaw).mock.calls[0][1];
    expect(putItem.condition).toBe("LIKE_NEW");
    expect(putItem.conditionDescription).toBe(item.conditionDescription);
    expect(putItem.product).toEqual({ ...item.product, title: after.title, description: "<p>new</p>", aspects: after.aspects });
    const putOffer = vi.mocked(client.putOfferRaw).mock.calls[0][0];
    expect(putOffer).toEqual({ ...offer, listingDescription: "<p>new</p>" });
  });

  it("raises the price for a special edition, keeping Best Offer at the same share, never lowering it", async () => {
    const client = fakeClient();
    await applyRefresh(client, item.sku, item.product.title, after, { price: 22, bestOfferMinPercent: 70, currency: "CAD" });
    const putOffer = vi.mocked(client.putOfferRaw).mock.calls[0][0] as Record<string, any>;
    expect(putOffer.pricingSummary.price).toEqual({ value: "22.00", currency: "CAD" });
    expect(putOffer.listingPolicies.bestOfferTerms.autoDeclinePrice.value).toBe("15.40");
    expect(putOffer.listingPolicies.fulfillmentPolicyId).toBe("F");

    const lower = fakeClient();
    await applyRefresh(lower, item.sku, item.product.title, after, { price: 9, currency: "CAD" });
    expect(vi.mocked(lower.putOfferRaw).mock.calls[0][0]).toEqual({ ...offer, listingDescription: "<p>new</p>" });
  });

  it("skips a listing that changed since the preview or is no longer live", async () => {
    const client = fakeClient();
    expect((await applyRefresh(client, item.sku, "Another title", after)).status).toBe("skipped");
    const ended = fakeClient({ getOffersRaw: vi.fn().mockResolvedValue([{ ...offer, status: "UNPUBLISHED" }]) });
    expect((await applyRefresh(ended, item.sku, item.product.title, after)).status).toBe("skipped");
    expect(client.putInventoryItemRaw).not.toHaveBeenCalled();
    expect(ended.putOfferRaw).not.toHaveBeenCalled();
  });
});
