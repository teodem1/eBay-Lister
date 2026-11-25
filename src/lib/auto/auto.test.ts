import { describe, expect, it } from "vitest";
import type { BatchItem } from "../batch/queue";
import type { GeneratedListing } from "../listing/types";
import type { PriceCheck } from "../../app/listing/priceRequest";
import type { PriceSuggestion } from "../pricing/suggestPrice";
import {
  CD_CATEGORY_ID,
  discogsCad,
  priceGrade,
  wantsDiscogs,
  compareToComparables,
  autoDraft,
  autoSummary,
  interruptedToWaiting,
  missingForAuto,
  finalAutoPrice,
  pickAutoPrice,
  priceBounds,
  priceEvidence,
  readyForAuto,
  toListEntry,
  applyCoverName,
  needsCoverName,
  noCopiesMessage,
  stageLabel,
  rescanned,
  retryByRescan,
} from "./auto";
import type { LookupResponse } from "../lookup";

const graded = { condition: "USED_EXCELLENT" as const, disc: "Near mint" as const, booklet: "Near mint" as const };

function cd(patch: Partial<BatchItem> = {}): BatchItem {
  return {
    id: "a",
    barcode: "075992731324",
    addedAt: "2026-11-23T00:00:00Z",
    status: "pending",
    lookup: "done",
    query: "Genesis Wind & Wuthering",
    condition: graded,
    auto: { stage: "waiting", photos: ["https://i.ebayimg.com/1.jpg", "https://i.ebayimg.com/2.jpg"] },
    ...patch,
  };
}

const suggestion = (usedCount: number, recommended: number) =>
  ({
    usedCount,
    currency: "CAD",
    assumedShipping: 5,
    itemPrice: { quickSale: recommended * 0.8, recommended, high: recommended * 1.25 },
    confidence: "medium",
  }) as unknown as PriceSuggestion;
const check = (sold: PriceSuggestion | null, current: PriceSuggestion | null): PriceCheck => ({
  sold,
  current,
  soldItems: [],
  currentItems: [],
  unavailable: {},
  keywords: "",
});

describe("missingForAuto / readyForAuto", () => {
  it("needs the album, both grades and a photo", () => {
    expect(missingForAuto(cd({ lookup: "loading" }))).toBe("Finding the album");
    expect(missingForAuto(cd({ lookup: "error" }))).toBe("Album not found");
    expect(missingForAuto(cd({ condition: { disc: "Near mint" } }))).toBe("Grade it");
    expect(missingForAuto(cd({ auto: { stage: "waiting", photos: [] } }))).toBe("Take the cover photos");
    expect(missingForAuto(cd({ auto: { stage: "waiting", photos: ["front"] } }))).toBe("Take the back cover photo");
    expect(missingForAuto(cd())).toBeNull();
    expect(missingForAuto(cd({ condition: { condition: "NEW" } }))).toBeNull();
  });

  it("skips failed, running and published CDs", () => {
    const items = [
      cd({ id: "1" }),
      cd({ id: "2", auto: { stage: "failed", photos: ["x"] } }),
      cd({ id: "3", auto: { stage: "writing", photos: ["x"] } }),
      cd({ id: "4", status: "listed", auto: { stage: "published", photos: ["x"] } }),
    ];
    expect(readyForAuto(items).map((x) => x.id)).toEqual(["1"]);
    expect(autoSummary(items)).toMatchObject({ ready: 1, running: 1, published: 1, failed: 1 });
  });
});

describe("interruptedToWaiting", () => {
  it("puts a CD left mid-run back to waiting and keeps its price check", () => {
    const priceCheck = check(suggestion(3, 20), null);
    const item = cd({ auto: { stage: "publishing", photos: ["x"], priceCheck } });
    expect(interruptedToWaiting(item).auto).toMatchObject({ stage: "waiting", priceCheck });
    const done = cd({ auto: { stage: "published", photos: ["x"] } });
    expect(interruptedToWaiting(done)).toBe(done);
  });
});

describe("pickAutoPrice", () => {
  it("prefers last sold, then current listings, else nothing", () => {
    expect(pickAutoPrice(check(suggestion(5, 18.5), suggestion(9, 25)))).toEqual({
      price: 18.5,
      basis: "From 5 sold copies (medium confidence)",
    });
    expect(pickAutoPrice(check(suggestion(0, 0), suggestion(1, 25)))?.price).toBe(25);
    expect(pickAutoPrice(check(null, null))).toBeNull();
  });
});

describe("autoDraft", () => {
  const generated = {
    draft: { sku: "BC-1", title: "T", categoryId: "", aspects: [], descriptionHtml: "<p>x</p>", quantity: 1, imageUrls: [], condition: "USED_EXCELLENT" },
  } as unknown as GeneratedListing;
  it("adds the price and photos and falls back to Music > CDs", () => {
    const d = autoDraft(generated, 15, ["https://p/1.jpg"]);
    expect(d).toMatchObject({ price: 15, imageUrls: ["https://p/1.jpg"], categoryId: CD_CATEGORY_ID, categoryName: "Music > CDs" });
  });
});

describe("toListEntry", () => {
  it("hands grades, photos and the price check to the To list tab", () => {
    const priceCheck = check(null, null);
    const entry = toListEntry(cd({ auto: { stage: "failed", photos: ["https://p/1.jpg", "https://p/2.jpg"], priceCheck } }));
    expect(entry.auto).toBeUndefined();
    expect(entry.origin).toBe("stack");
    expect(entry.progress).toMatchObject({ imageText: "https://p/1.jpg\nhttps://p/2.jpg", condition: graded, priceCheck });
  });
});

describe("Claude's price pick", () => {
  const c = check(suggestion(6, 20), suggestion(9, 25));
  it("gives Claude the sold copies and the allowed range", () => {
    const text = priceEvidence({
      ...c,
      soldItems: [{ title: "Genesis Wind CD", price: { value: 18, currency: "CAD" }, shippingCost: { value: 4, currency: "CAD" }, soldDate: "2026-10-01T00:00:00Z", condition: "Very Good" } as never],
    });
    expect(text).toContain("Sold copies (CAD, 6 copies, medium confidence): quick sale 16.00, typical 20.00, high 25.00");
    expect(text).toContain("- 18.00 + 4.00 shipping, sold 2026-10-01, Very Good: Genesis Wind CD");
    expect(text).toContain("Allowed range: 13.60 to 28.75.");
  });

  it("keeps Claude's price inside the range, else falls back", () => {
    expect(priceBounds(c)).toEqual({ min: 13.6, max: 28.75 });
    expect(finalAutoPrice(c, { price: 22, reason: "Recent sales" })).toEqual({ price: 22, basis: "Claude: Recent sales" });
    expect(finalAutoPrice(c, { price: 99, reason: "x" })?.price).toBe(28.75);
    expect(finalAutoPrice(c, undefined)?.price).toBe(20);
  });
});

describe("compareToComparables", () => {
  const sold = (v: number) => ({ price: { value: v, currency: "CAD" } }) as never;
  it("places the price among the sold copies, else the current listings", () => {
    const c = { ...check(null, null), soldItems: [sold(12), sold(20), sold(15), sold(18)], currentItems: [sold(30)] };
    expect(compareToComparables(17, c)).toEqual({ basis: "sold", count: 4, min: 12, max: 20, median: 16.5, cheaper: 2 });
    expect(compareToComparables(17, { ...c, soldItems: [] })?.basis).toBe("current");
    expect(compareToComparables(17, check(null, null))).toBeNull();
    expect(compareToComparables(17, undefined)).toBeNull();
  });
});

describe("collectible CDs and Discogs", () => {
  const ref = { releaseId: 1, title: "", url: "", suggestions: { "Near Mint (NM or M-)": 40, "Very Good (VG)": 20 }, suggestionCurrency: "CAD" };
  it("uses the worse of disc and inlay as the price grade", () => {
    expect(priceGrade({ disc: "Near mint", booklet: "Very good" })).toBe("Very good");
    expect(priceGrade({ disc: "Very good", booklet: "Missing" })).toBe("Good");
    expect(priceGrade({ condition: "NEW" })).toBe("Mint");
  });
  it("asks Discogs for CDs worth more than a usual CD, or with no eBay copies", () => {
    expect(wantsDiscogs(check(suggestion(5, 12), null))).toBe(false);
    expect(wantsDiscogs(check(suggestion(5, 30), null))).toBe(true);
    expect(wantsDiscogs(check(null, null))).toBe(true);
  });
  it("lets the Discogs price widen the range, or set it when eBay found nothing", () => {
    const c = check(suggestion(4, 30), null);
    expect(priceBounds(c, discogsCad(ref, "Near mint"))).toEqual({ min: 20.4, max: 46 });
    expect(priceBounds(check(null, null), 40)).toEqual({ min: 28, max: 46 });
    expect(finalAutoPrice(check(null, null), undefined, 40)).toMatchObject({ price: 40 });
    expect(discogsCad({ ...ref, suggestionCurrency: "USD" }, "Near mint")).toBeUndefined();
    expect(priceEvidence(c, 15, { ref, grade: "Near mint" })).toContain("Discogs price guide");
  });
});

describe("naming a CD from its front cover", () => {
  const unknown = cd({ title: undefined, query: "075778485496", barcode: "075778485496" });
  const cover = (patch: Partial<LookupResponse> = {}): LookupResponse => ({
    source: "photo",
    query: "Peter Gabriel II Scratch CD",
    identification: {
      identified: true,
      title: "Peter Gabriel II CD",
      brand: "",
      model: "",
      category: "Music CDs",
      gtin: "",
      conditionNotes: "",
      music: { artist: "Peter Gabriel", album: "Peter Gabriel (II)", year: "1978" },
      searchQuery: "Peter Gabriel II Scratch CD",
      confidence: "high",
    },
    results: { total: 0, items: [] },
    notes: [],
    ...patch,
  });

  it("only when the barcode named no album and there is a cover photo, once", () => {
    expect(needsCoverName(unknown)).toBe(true);
    expect(needsCoverName(cd({ title: "Wind & Wuthering" }))).toBe(false);
    expect(needsCoverName(cd({ title: undefined, auto: { stage: "waiting", photos: [] } }))).toBe(false);
    expect(needsCoverName(applyCoverName(unknown, null))).toBe(false);
  });

  it("names the CD and drops the price check made from the bare barcode", () => {
    const priced = cd({
      ...unknown,
      auto: { ...unknown.auto!, priceCheck: check(null, null), discogs: null, discogsNote: "Discogs doesn't know this barcode." },
    });
    const named = applyCoverName(priced, cover());
    expect(named.title).toBe("Peter Gabriel (II)");
    expect(named.artist).toBe("Peter Gabriel");
    expect(named.query).toBe("Peter Gabriel II CD");
    expect(named.barcode).toBe("075778485496");
    expect(named.scanned?.barcode).toBe("075778485496");
    expect(named.auto?.priceCheck).toBeUndefined();
    expect(named.auto?.discogs).toBeUndefined();
    expect(named.auto?.coverChecked).toBe(true);
    expect(named.auto?.photos).toEqual(unknown.auto!.photos);
  });

  it("keeps everything when Claude couldn't read the cover", () => {
    const priced = cd({ ...unknown, auto: { ...unknown.auto!, priceCheck: check(null, null) } });
    const unread = cover({ identification: { ...cover().identification!, identified: false, title: "", music: { artist: "", album: "", year: "" } } });
    const after = applyCoverName(priced, unread);
    expect(after.title).toBeUndefined();
    expect(after.query).toBe("075778485496");
    expect(after.auto?.priceCheck).toBeDefined();
    expect(after.auto?.coverChecked).toBe(true);
  });

  it("says what was searched when nothing is found", () => {
    expect(noCopiesMessage(unknown)).toContain("barcode 075778485496");
    expect(noCopiesMessage(cd({ title: "Wind & Wuthering", artist: "Genesis" }))).toContain("Genesis – Wind & Wuthering");
    expect(stageLabel("identifying")).toBe("Reading the cover…");
  });

  it("a CD left while reading the cover goes back to waiting", () => {
    expect(interruptedToWaiting(cd({ auto: { stage: "identifying", photos: [] } })).auto?.stage).toBe("waiting");
  });
});

describe("Try again rescans the barcode", () => {
  const failed = cd({
    title: undefined,
    query: "075778485496",
    barcode: "075778485496",
    auto: { stage: "failed", error: "Nothing found", photos: ["https://i.ebayimg.com/1.jpg"], priceCheck: check(null, null), coverChecked: true },
  });

  it("only for a CD that failed before Claude wrote it", () => {
    expect(retryByRescan(failed)).toBe(true);
    expect(retryByRescan(cd({ auto: { ...failed.auto!, draft: {} as never } }))).toBe(false);
    expect(retryByRescan(cd())).toBe(false);
  });

  it("a new barcode is looked up again from scratch, keeping photos and grades", () => {
    const after = rescanned(failed, "075678163221");
    expect(after.barcode).toBe("075678163221");
    expect(after.lookup).toBe("queued");
    expect(after.query).toBeUndefined();
    expect(after.auto?.stage).toBe("waiting");
    expect(after.auto?.priceCheck).toBeUndefined();
    expect(after.auto?.coverChecked).toBeUndefined();
    expect(after.auto?.photos).toEqual(failed.auto!.photos);
    expect(after.condition).toEqual(failed.condition);
  });

  it("the same barcode keeps its price check (no second sold-price check)", () => {
    expect(rescanned(failed, "075778485496").auto?.priceCheck).toBeDefined();
  });
});
