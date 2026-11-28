/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import type { LiveDetail } from "../ebay/refreshListings";
import { applyProposal, checkProposal } from "./apply";
import type { Proposal } from "./types";

const OLD_TITLE = "Genesis Wind & Wuthering RARE CD (Disc: Near Mint / Inlay: Very Good)";
const NEW_TITLE = "Genesis Wind & Wuthering Rare 1976 CD (Disc: Near Mint / Inlay: Very Good)";

const item = {
  sku: "BC-075678154323-ABCDE",
  condition: "LIKE_NEW",
  conditionDescription: "Disc: near mint. Inlay / booklet: very good.",
  availability: { shipToLocationAvailability: { quantity: 1 } },
  product: {
    title: OLD_TITLE,
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
  listing: { listingId: "1" },
  listingDescription: "<p>old</p>",
  pricingSummary: { price: { value: "17.50", currency: "CAD" } },
  listingPolicies: { bestOfferTerms: { bestOfferEnabled: true, autoDeclinePrice: { value: "12.25", currency: "CAD" } } },
};

function fakeClient(over: { item?: unknown; offers?: unknown[]; putOffer?: () => Promise<void> } = {}) {
  return {
    getInventoryItemRaw: vi.fn().mockResolvedValue(structuredClone(over.item ?? item)),
    getOffersRaw: vi.fn().mockResolvedValue(structuredClone(over.offers ?? [offer])),
    putInventoryItemRaw: vi.fn().mockResolvedValue(undefined),
    putOfferRaw: vi.fn(over.putOffer ?? (async () => undefined)),
    findSkus: vi.fn().mockResolvedValue([]),
  } as any;
}

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  sku: item.sku,
  runId: "r1",
  createdAt: "2026-11-28T00:00:00.000Z",
  snapshot: { title: OLD_TITLE, price: 17.5 },
  title: NEW_TITLE,
  addAspects: { "Record Label": ["Atlantic"] },
  appendHtml: "<p>Made in Canada.</p>",
  price: 21,
  pendingPrice: null,
  evidence: "7 sales",
  engagement: { level: "normal", sold: 7, listed: 9, monthsOfSupply: 6, reason: "r" },
  flags: [],
  status: "open",
  ...over,
});

const live = (over: Partial<LiveDetail> = {}): LiveDetail => ({
  sku: item.sku,
  title: OLD_TITLE,
  price: 17.5,
  currency: "CAD",
  query: "Genesis Wind & Wuthering",
  aspects: item.product.aspects,
  descriptionHtml: "<p>old</p>",
  sellerCondition: { condition: "USED_VERY_GOOD", disc: "Near mint", booklet: "Very good" },
  imageUrls: [],
  ...over,
});

const opts = { bestOfferMinPercent: 70, currency: "CAD" };

describe("checkProposal", () => {
  it("passes a good proposal", () => {
    expect(checkProposal(live(), proposal())).toEqual([]);
  });

  it("refuses a title over 80 characters", () => {
    const long = `Genesis Wind & Wuthering Rare ${"x".repeat(40)} CD (Disc: Near Mint / Inlay: Very Good)`;
    expect(checkProposal(live(), proposal({ title: long })).join(" ")).toContain("80");
  });

  it("refuses a title that drops a word of the old one", () => {
    expect(checkProposal(live(), proposal({ title: "Genesis Wind & Wuthering 1976 CD (Disc: Near Mint / Inlay: Very Good)" })).join(" ")).toMatch(/rare/i);
  });

  it("refuses changed or missing grades, but allows their short form", () => {
    expect(checkProposal(live(), proposal({ title: NEW_TITLE.replace("Inlay: Very Good", "Inlay: Good") })).join(" ")).toMatch(/grade/i);
    expect(checkProposal(live(), proposal({ title: "Genesis Wind & Wuthering Rare 1976 CD" })).join(" ")).toMatch(/grade/i);
    expect(checkProposal(live(), proposal({ title: "Genesis Wind & Wuthering Rare Canada 1976 Atlantic Records CD (NM/VG)" }))).toEqual([]);
  });

  it("lets a title without grades gain only the listing's own", () => {
    const bare = live({ title: "Genesis Wind & Wuthering RARE CD" });
    const snap = { snapshot: { title: "Genesis Wind & Wuthering RARE CD", price: 17.5 } };
    expect(checkProposal(bare, proposal(snap))).toEqual([]);
    expect(checkProposal(bare, proposal({ ...snap, title: NEW_TITLE.replace("Inlay: Very Good", "Inlay: Mint") })).join(" ")).toMatch(/grade/i);
  });

  it("refuses an added specific the listing has, in any letter case", () => {
    expect(checkProposal(live(), proposal({ addAspects: { artist: ["Genesis"] } })).join(" ")).toMatch(/artist/i);
  });

  it("refuses prices that are not positive", () => {
    expect(checkProposal(live(), proposal({ price: 0 }))).not.toEqual([]);
    expect(checkProposal(live(), proposal({ pendingPrice: -1 }))).not.toEqual([]);
  });
});

describe("applyProposal", () => {
  it("sends the text without the price, then the price alone", async () => {
    const client = fakeClient();
    const out = await applyProposal(client, proposal(), false, opts);
    expect(out.status).toBe("applied");
    expect(out.result).toMatchObject({ text: "updated", price: "updated" });
    const [, sentItem] = client.putInventoryItemRaw.mock.calls[0];
    expect(sentItem.product.title).toBe(NEW_TITLE);
    expect(sentItem.product.aspects["Record Label"]).toEqual(["Atlantic"]);
    expect(sentItem.product.aspects.Artist).toEqual(["Genesis"]);
    const offers = client.putOfferRaw.mock.calls.map(([o]: any[]) => o.pricingSummary.price.value);
    expect(offers).toEqual(["17.50", "21.00"]);
    expect(client.putOfferRaw.mock.calls[0][0].listingDescription).toBe("<p>old</p><p>Made in Canada.</p>");
  });

  it("skips a listing changed since the proposal as stale, sending nothing", async () => {
    for (const p of [proposal({ snapshot: { title: "Something else", price: 17.5 } }), proposal({ snapshot: { title: OLD_TITLE, price: 15 } })]) {
      const client = fakeClient();
      const out = await applyProposal(client, p, false, opts);
      expect(out.status).toBe("stale");
      expect(client.putInventoryItemRaw).not.toHaveBeenCalled();
      expect(client.putOfferRaw).not.toHaveBeenCalled();
    }
  });

  it("skips a listing that is no longer live as stale", async () => {
    const client = fakeClient({ offers: [{ ...offer, status: "UNPUBLISHED" }] });
    expect((await applyProposal(client, proposal(), false, opts)).status).toBe("stale");
  });

  it("refuses a proposal with problems, sending nothing", async () => {
    const client = fakeClient();
    const out = await applyProposal(client, proposal({ title: "Genesis CD" }), false, opts);
    expect(out.status).toBe("failed");
    expect(client.putOfferRaw).not.toHaveBeenCalled();
  });

  it("uses the pending price only when accepted", async () => {
    const one = fakeClient();
    await applyProposal(one, proposal({ pendingPrice: 30 }), false, opts);
    expect(one.putOfferRaw.mock.calls.at(-1)![0].pricingSummary.price.value).toBe("21.00");
    const two = fakeClient();
    await applyProposal(two, proposal({ pendingPrice: 30 }), true, opts);
    expect(two.putOfferRaw.mock.calls.at(-1)![0].pricingSummary.price.value).toBe("30.00");
  });

  it("reports the text saved and the price failed when only the price write fails", async () => {
    let calls = 0;
    const client = fakeClient({ putOffer: async () => { if (++calls === 2) throw new Error("eBay price error"); } });
    const out = await applyProposal(client, proposal(), false, opts);
    expect(out.status).toBe("applied");
    expect(out.result).toMatchObject({ text: "updated", price: "failed" });
    expect(out.result.reason).toMatch(/price/i);
  });

  it("makes no price change when the text could not be saved", async () => {
    const client = fakeClient({ putOffer: async () => { throw new Error("eBay down"); } });
    const out = await applyProposal(client, proposal(), false, opts);
    expect(out.result).toMatchObject({ text: "failed", price: "skipped" });
    expect(client.putOfferRaw).toHaveBeenCalledTimes(1);
  });

  it("changes only the price when the text is unchanged", async () => {
    const client = fakeClient();
    const out = await applyProposal(client, proposal({ title: OLD_TITLE, addAspects: {}, appendHtml: "" }), false, opts);
    expect(out.result).toMatchObject({ text: "unchanged", price: "updated" });
    expect(client.putInventoryItemRaw).not.toHaveBeenCalled();
  });
});
