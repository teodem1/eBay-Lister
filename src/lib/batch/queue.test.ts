import { describe, expect, it } from "vitest";
import type { LookupResponse } from "../lookup";
import {
  addCode,
  applyLookup,
  batchItemName,
  batchListingHref,
  lookupsToStart,
  nextPending,
  retryScan,
  summarize,
  type BatchItem,
} from "./queue";

const now = new Date("2026-11-23T03:00:00Z");

function queue(...codes: string[]): BatchItem[] {
  return codes.reduce<BatchItem[]>((items, c) => addCode(items, c, now).items, []);
}

describe("addCode", () => {
  it("adds new barcodes to the end of the queue", () => {
    const items = queue("111", "222");
    expect(items.map((x) => x.barcode)).toEqual(["111", "222"]);
    expect(items[0]).toMatchObject({ status: "pending", lookup: "queued", addedAt: now.toISOString() });
  });

  it("ignores a barcode already waiting in the queue", () => {
    const items = queue("111");
    const result = addCode(items, "111", now);
    expect("duplicate" in result && result.duplicate.id).toBe(items[0].id);
    expect(result.items).toHaveLength(1);
  });

  it("queues a barcode again once its earlier copy was listed", () => {
    const items = queue("111").map((x) => ({ ...x, status: "listed" as const }));
    const result = addCode(items, "111", now);
    expect("added" in result).toBe(true);
    expect(result.items).toHaveLength(2);
  });
});

describe("applyLookup", () => {
  const data: LookupResponse = {
    source: "barcode",
    gtin: "0724384260927",
    results: { total: 1, items: [{ itemId: "1", title: "Radiohead OK Computer CD", imageUrl: "https://i.ebayimg.com/a.jpg" }] },
    album: { title: "OK Computer", artist: "Radiohead", year: 1997, coverUrl: "https://coverartarchive.org/x", genres: [], mbid: "m" },
    notes: [],
  };

  it("names the CD from the album and keeps the scan for the Collection", () => {
    const item = applyLookup({ ...queue("0724384260927")[0], lookup: "loading" }, data);
    expect(item).toMatchObject({
      lookup: "done",
      title: "OK Computer",
      artist: "Radiohead",
      year: 1997,
      coverUrl: "https://coverartarchive.org/x",
      query: "Radiohead OK Computer",
    });
    expect(item.scanned?.barcode).toBe("0724384260927");
    expect(batchItemName(item)).toBe("OK Computer");
  });

  it("falls back to the barcode when nothing names the CD", () => {
    const item = applyLookup(queue("123")[0], { ...data, album: undefined, results: { total: 0, items: [] } });
    expect(item.title).toBeUndefined();
    expect(batchItemName(item)).toBe("Barcode 123");
  });
});

describe("lookupsToStart", () => {
  it("fetches at most two names at a time", () => {
    const items = queue("1", "2", "3");
    expect(lookupsToStart(items, new Set()).map((x) => x.barcode)).toEqual(["1", "2"]);
    expect(lookupsToStart(items, new Set([items[0].id])).map((x) => x.barcode)).toEqual(["2"]);
    expect(lookupsToStart(items, new Set([items[0].id, items[1].id]))).toEqual([]);
  });

  it("retries an item left loading when the screen closed, but not finished or failed ones", () => {
    const [a, b, c] = queue("1", "2", "3");
    const items = [{ ...a, lookup: "loading" as const }, { ...b, lookup: "done" as const }, { ...c, lookup: "error" as const }];
    expect(lookupsToStart(items, new Set()).map((x) => x.barcode)).toEqual(["1"]);
  });
});

describe("nextPending", () => {
  it("picks the next waiting CD after the one just listed", () => {
    const [a, b, c] = queue("1", "2", "3");
    const items = [{ ...a, status: "listed" as const }, b, c];
    expect(nextPending(items)?.barcode).toBe("2");
    expect(nextPending(items, a.id)?.barcode).toBe("2");
    expect(nextPending(items, b.id)?.barcode).toBe("3");
    expect(nextPending(items, c.id)?.barcode).toBe("2");
    expect(nextPending([{ ...a, status: "listed" }])).toBeUndefined();
  });
});

describe("summarize", () => {
  it("counts the queue and the price checks it used", () => {
    const [a, b, c] = queue("1", "2", "3");
    const items = [{ ...a, status: "listed" as const, openedAt: "x" }, { ...b, openedAt: "y" }, { ...c, status: "skipped" as const }];
    expect(summarize(items)).toEqual({ pending: 1, listed: 1, skipped: 1, priceChecks: 2 });
  });
});

describe("batchListingHref", () => {
  it("links to the listing screen with the grades and the queue id", () => {
    const item = { ...queue("0724384260927")[0], query: "Radiohead OK Computer" };
    const href = batchListingHref(item, { disc: "Near mint", inlay: "Very good" });
    const url = new URL(href, "https://x");
    expect(url.pathname).toBe("/listing");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "Radiohead OK Computer",
      barcode: "0724384260927",
      disc: "Near mint",
      inlay: "Very good",
      batch: item.id,
    });
  });
});

describe("retryScan", () => {
  const photos = ["https://i.ebayimg.com/front.jpg", "https://i.ebayimg.com/back.jpg"];
  function withWork(item: BatchItem): BatchItem {
    return { ...item, condition: { disc: "Near mint" }, auto: { stage: "waiting", photos } };
  }

  it("keeps the photos and grades taken after a misread scan, on the same CD with the new barcode", () => {
    const first = withWork({ ...queue("111")[0], lookup: "error", error: "Not found" });
    const out = retryScan([first], first.id, "222", now);
    expect(out).toMatchObject({ id: first.id, isNew: true });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ id: first.id, barcode: "222", lookup: "queued", condition: { disc: "Near mint" } });
    expect(out.items[0].error).toBeUndefined();
    expect(out.items[0].auto?.photos).toEqual(photos);
  });

  it("keeps the CD as it is when the rescan reads the same barcode", () => {
    const first = withWork(queue("111")[0]);
    expect(retryScan([first], first.id, "111", now)).toEqual({ items: [first], id: first.id, isNew: true });
  });

  it("drops a first scan with no photos or grades and adds the new barcode, as before", () => {
    const [first] = queue("111");
    const out = retryScan([first], first.id, "222", now);
    expect(out.items.map((x) => x.barcode)).toEqual(["222"]);
    expect(out.isNew).toBe(true);
  });

  it("moves the work to a CD already in the pile with that barcode", () => {
    const [other, plain] = queue("222", "111");
    const first = withWork(plain);
    const out = retryScan([other, first], first.id, "222", now);
    expect(out).toMatchObject({ id: other.id, isNew: false });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].auto?.photos).toEqual(photos);
  });

  it("never overwrites a CD that already has its own photos", () => {
    const [a, b] = queue("222", "111").map(withWork);
    const out = retryScan([a, b], b.id, "222", now);
    expect(out.items).toEqual([a, b]);
    expect(out.id).toBe(a.id);
  });
});
