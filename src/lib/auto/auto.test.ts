import { describe, expect, it } from "vitest";
import type { BatchItem } from "../batch/queue";
import type { GeneratedListing } from "../listing/types";
import type { PriceCheck } from "../../app/listing/priceRequest";
import type { PriceSuggestion } from "../pricing/suggestPrice";
import {
  CD_CATEGORY_ID,
  autoDraft,
  autoSummary,
  interruptedToWaiting,
  missingForAuto,
  pickAutoPrice,
  readyForAuto,
  toListEntry,
} from "./auto";

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
    auto: { stage: "waiting", photos: ["https://i.ebayimg.com/1.jpg"] },
    ...patch,
  };
}

const suggestion = (usedCount: number, recommended: number) =>
  ({ usedCount, itemPrice: { recommended }, confidence: "medium" }) as unknown as PriceSuggestion;
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
    expect(missingForAuto(cd({ auto: { stage: "waiting", photos: [] } }))).toBe("Take a photo");
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
