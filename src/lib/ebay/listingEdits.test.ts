import { describe, expect, it, vi } from "vitest";
import { applyCollectionEdit, patchedTitle, setAspect } from "./listingEdits";
import type { EbaySellClient } from "./sell";

describe("patchedTitle", () => {
  it("swaps artist and album and keeps the grades", () => {
    expect(
      patchedTitle(
        "Pink Floyd Medle CD (Disc: Mint / Inlay: Near Mint)",
        { artist: "Pink Floyd", title: "Medle" },
        { artist: "Pink Floyd", title: "Meddle" },
      ),
    ).toBe("Pink Floyd Meddle CD (Disc: Mint / Inlay: Near Mint)");
  });
  it("leaves the title alone when the new one would be too long", () => {
    const t = "Genesis Wind CD (Disc: Near Mint / Inlay: Near Mint)";
    expect(patchedTitle(t, { artist: "Genesis", title: "Wind" }, { artist: "Genesis", title: "W".repeat(60) })).toBe(t);
  });
});

describe("setAspect", () => {
  it("keeps the name the listing uses", () => {
    expect(setAspect({ Artist: ["A"] }, ["artist"], "B")).toEqual({ Artist: ["B"] });
    expect(setAspect({}, ["release year"], "1971")).toEqual({ "Release Year": ["1971"] });
    expect(setAspect({ "Release Year": ["1970"] }, ["release year"], undefined)).toEqual({});
  });
});

function fakeClient(offer: Record<string, unknown> | null, item: Record<string, unknown> = {}) {
  return {
    getOffersRaw: vi.fn(async () => (offer ? [offer] : [])),
    findSkus: vi.fn(async () => (offer ? ["BC-123-AAA"] : [])),
    getInventoryItemRaw: vi.fn(async () => item),
    putInventoryItemRaw: vi.fn<(sku: string, item: unknown) => Promise<void>>(async () => {}),
    putOfferRaw: vi.fn<(offer: unknown) => Promise<void>>(async () => {}),
  };
}

const offer = {
  offerId: "O1",
  status: "PUBLISHED",
  listing: { listingId: "L1" },
  pricingSummary: { price: { value: "18.49", currency: "CAD" } },
  listingPolicies: { fulfillmentPolicyId: "F", bestOfferTerms: { bestOfferEnabled: true, autoDeclinePrice: { value: "13.86", currency: "CAD" } } },
};
const base = { title: "Meddle", artist: "Pink Floyd", year: 1971, price: 18.49 };

describe("applyCollectionEdit", () => {
  it("changes the price and keeps Best Offer at the same share", async () => {
    const c = fakeClient(offer);
    const r = await applyCollectionEdit(c as unknown as EbaySellClient, { sku: "BC-123-AAA", before: base, after: { ...base, price: 20 } }, { bestOfferMinPercent: 70, currency: "CAD" });
    expect(r).toEqual({ status: "updated", sku: "BC-123-AAA", listingId: "L1", changed: ["price"] });
    const sent = c.putOfferRaw.mock.calls[0][0] as unknown as typeof offer;
    expect(sent.pricingSummary.price.value).toBe("20.00");
    expect(sent.listingPolicies.bestOfferTerms.autoDeclinePrice.value).toBe("14.00");
    expect(sent.listingPolicies.fulfillmentPolicyId).toBe("F");
    expect(c.putInventoryItemRaw).not.toHaveBeenCalled();
  });

  it("updates the title and item specifics for a new album name", async () => {
    const c = fakeClient(offer, { product: { title: "Pink Floyd Medle CD (Disc: Mint / Inlay: Mint)", aspects: { "Release Title": ["Medle"], Artist: ["Pink Floyd"] } } });
    const before = { ...base, title: "Medle" };
    await applyCollectionEdit(c as unknown as EbaySellClient, { barcode: "123", before, after: base }, { currency: "CAD" });
    const [, item] = c.putInventoryItemRaw.mock.calls[0] as unknown as [string, { product: { title: string; aspects: Record<string, string[]> } }];
    expect(item.product.title).toBe("Pink Floyd Meddle CD (Disc: Mint / Inlay: Mint)");
    expect(item.product.aspects["Release Title"]).toEqual(["Meddle"]);
  });

  it("says so when there is no live listing", async () => {
    const r = await applyCollectionEdit(fakeClient(null) as unknown as EbaySellClient, { barcode: "123", before: base, after: { ...base, price: 20 } }, { currency: "CAD" });
    expect(r.status).toBe("not_found");
  });
});
