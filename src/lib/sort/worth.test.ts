import { describe, expect, it } from "vitest";
import type { PriceCheck } from "../../app/listing/priceRequest";
import type { PriceSuggestion } from "../pricing/suggestPrice";
import type { BatchItem } from "../batch/queue";
import { itemFromSort } from "../batch/queue";
import { cleanShelf } from "../identify/shelf";
import {
  checkFromItems,
  checkKey,
  netAfterFees,
  rankCds,
  sessionFromShelf,
  sortKeywords,
  sortPrice,
  toPrice,
  verdict,
  type SortCd,
} from "./worth";

const suggestion = (recommended: number, usedCount = 5) =>
  ({ usedCount, currency: "CAD", itemPrice: { quickSale: recommended - 2, recommended, high: recommended + 2 } }) as PriceSuggestion;

const check = (sold: number | null, current: number | null = null, keywords = "x"): PriceCheck => ({
  sold: sold === null ? null : suggestion(sold),
  current: current === null ? null : suggestion(current),
  soldItems: [],
  currentItems: [],
  unavailable: {},
  keywords,
});

const cd = (over: Partial<SortCd>): SortCd => ({
  id: over.album ?? "id",
  artist: "Genesis",
  album: "Duke",
  year: "",
  edition: "",
  barcode: "",
  confidence: "high",
  selected: true,
  state: "new",
  ...over,
});

describe("netAfterFees", () => {
  it("takes eBay, promoted and order fees on price plus shipping, and the mailer", () => {
    // 20 + 7.99 = 27.99; 25.95% = 7.26; order fee 0.40; mailer 1.
    expect(netAfterFees(20)).toBeCloseTo(11.34, 2);
    // 2 + 7.99 = 9.99 -> 30 cent order fee.
    expect(netAfterFees(2)).toBeCloseTo(2 - 2.59 - 0.3 - 1, 1);
  });
});

describe("sortPrice and verdict", () => {
  it("prefers last sold, falls back to listings", () => {
    expect(sortPrice(check(20, 30))).toMatchObject({ price: 20, from: "sold" });
    expect(sortPrice(check(null, 30))).toMatchObject({ price: 30, from: "listed" });
    expect(sortPrice(check(null, null))).toBeNull();
  });
  it("judges against the bar", () => {
    expect(verdict(cd({ state: "priced", check: check(20) }), 5)).toBe("worth");
    expect(verdict(cd({ state: "priced", check: check(8) }), 5)).toBe("low");
    expect(verdict(cd({ state: "priced", check: check(null) }), 5)).toBe("none");
    expect(verdict(cd({ state: "new" }), 5)).toBeNull();
  });
});

describe("rankCds", () => {
  it("puts the best net first, then low, no data and unpriced", () => {
    const cds = [
      cd({ album: "unpriced" }),
      cd({ album: "none", state: "priced", check: check(null) }),
      cd({ album: "low", state: "priced", check: check(6) }),
      cd({ album: "good", state: "priced", check: check(15) }),
      cd({ album: "best", state: "priced", check: check(40) }),
    ];
    expect(rankCds(cds, 5).map((c) => c.album)).toEqual(["best", "good", "low", "none", "unpriced"]);
  });
});

describe("sessionFromShelf", () => {
  it("leaves hard-to-read CDs unticked and drops bad barcodes", () => {
    const s = sessionFromShelf([
      { artist: "A", album: "B", year: "", edition: "", barcode: "123", confidence: "high" },
      { artist: "C", album: "D", year: "", edition: "", barcode: "075678256725", confidence: "low" },
    ]);
    expect(s.cds.map((c) => c.selected)).toEqual([true, false]);
    expect(s.cds.map((c) => c.barcode)).toEqual(["", "075678256725"]);
  });
});

describe("toPrice", () => {
  it("counts only the lookups not already on the phone", () => {
    const cds = [cd({ album: "a" }), cd({ album: "b" }), cd({ album: "c", selected: false }), cd({ album: "d", state: "priced" })];
    const plan = toPrice(cds, (c) => c.album === "b");
    expect(plan.all.map((c) => c.album)).toEqual(["a", "b"]);
    expect(plan.paid).toBe(1);
  });
});

describe("checkKey and checkFromItems", () => {
  it("ignores case, punctuation and filler words", () => {
    expect(checkKey("The Beatles - Abbey Road CD")).toBe(checkKey("beatles abbey road"));
    expect(sortKeywords({ artist: " Pink Floyd ", album: "The Wall", edition: "2CD" })).toBe("Pink Floyd The Wall 2CD");
  });
  it("finds a check saved on a To list or Auto CD", () => {
    const saved = check(12, null, "Genesis Duke");
    const items = [
      { id: "1", barcode: "", progress: { priceCheck: saved } } as unknown as BatchItem,
    ];
    expect(checkFromItems(items, checkKey("genesis duke"))).toBe(saved);
    expect(checkFromItems(items, checkKey("genesis abacab"))).toBeUndefined();
  });
});

describe("itemFromSort", () => {
  it("makes a ready-to-list To list entry with the price check", () => {
    const c = check(12);
    const item = itemFromSort({ artist: "Genesis", album: "Duke", year: "1980", barcode: "", keywords: "Genesis Duke", check: c });
    expect(item).toMatchObject({ status: "pending", lookup: "done", title: "Duke", artist: "Genesis", year: 1980, query: "Genesis Duke" });
    expect(item.priceCheck).toBe(c);
  });
});

describe("cleanShelf", () => {
  it("drops empty and repeated reads", () => {
    const base = { year: "", edition: "", barcode: "", confidence: "high" as const };
    const out = cleanShelf([
      { ...base, artist: "Genesis", album: "Duke" },
      { ...base, artist: " genesis", album: "DUKE " },
      { ...base, artist: "", album: "" },
      { ...base, artist: "Yes", album: "90125", barcode: "0-7567-90125-2" },
    ]);
    expect(out.map((c) => c.album)).toEqual(["Duke", "90125"]);
    expect(out[1].barcode).toBe("07567901252");
  });
});
