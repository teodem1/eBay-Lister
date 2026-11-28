import { describe, expect, it } from "vitest";
import type { LookupResponse } from "../lookup";
import {
  allCategories,
  estimatePrice,
  filterItems,
  itemFromLookup,
  mergeBackup,
  parseBackup,
  saveReviewed,
  itemFromListing,
  isSold,
  markSold,
  NOT_SOLD,
  soldTotal,
  today,
  trimCheck,
  totalValue,
  upsert,
  withCategory,
  type CollectionItem,
} from "./collection";

const now = new Date("2026-11-22T12:00:00Z");

function lookup(extra: Partial<LookupResponse> = {}): LookupResponse {
  return {
    source: "barcode",
    gtin: "0724384260927",
    results: {
      total: 3,
      items: [
        { itemId: "1", title: "Radiohead OK Computer CD", price: { value: "12.00", currency: "CAD" }, imageUrl: "https://i.ebayimg.com/a.jpg" },
        { itemId: "2", title: "OK Computer", price: { value: "20.00", currency: "CAD" } },
        { itemId: "3", title: "OK Computer", price: { value: "15.50", currency: "CAD" } },
        { itemId: "4", title: "OK Computer (US)", price: { value: "99", currency: "USD" } },
      ],
    },
    notes: [],
    ...extra,
  };
}

const album = { title: "OK Computer", artist: "Radiohead", year: 1997, coverUrl: "https://coverartarchive.org/x", genres: ["alternative rock"], mbid: "m1" };

function item(p: Partial<CollectionItem>): CollectionItem {
  return { id: p.title ?? "x", title: "", artist: "", categories: [], addedAt: now.toISOString(), updatedAt: now.toISOString(), ...p };
}

describe("itemFromLookup", () => {
  it("uses MusicBrainz details and the median CAD price", () => {
    const out = itemFromLookup(lookup({ album }), now)!;
    expect(out).toMatchObject({
      title: "OK Computer",
      artist: "Radiohead",
      year: 1997,
      coverUrl: "https://coverartarchive.org/x",
      fallbackCoverUrl: "https://i.ebayimg.com/a.jpg",
      barcode: "0724384260927",
      price: 15.5,
      priceSource: "estimate",
      categories: ["Alternative rock"],
    });
  });

  it("falls back to what Claude read off the cover, then eBay", () => {
    const out = itemFromLookup(
      lookup({
        identification: { title: "CD", brand: "", music: { album: "Blue", artist: "Joni Mitchell", year: "1971" } } as LookupResponse["identification"],
      }),
    )!;
    expect(out).toMatchObject({ title: "Blue", artist: "Joni Mitchell", year: 1971, coverUrl: "https://i.ebayimg.com/a.jpg" });
    expect(itemFromLookup(lookup())!.title).toBe("Radiohead OK Computer CD");
    expect(itemFromLookup(lookup({ results: { total: 0, items: [] } }))).toBeNull();
  });
});

describe("estimatePrice", () => {
  it("is undefined without CAD prices", () => {
    expect(estimatePrice(lookup({ results: { total: 0, items: [] } }))).toBeUndefined();
  });
});

describe("upsert", () => {
  it("adds new CDs first and refreshes a rescan without losing edits", () => {
    const a = item({ id: "a", title: "OK Computer", artist: "Radiohead", barcode: "1", price: 30, priceSource: "manual", categories: ["Rock"] });
    const b = item({ id: "b", title: "Blue", artist: "Joni Mitchell" });
    const first = upsert([a], b);
    expect(first.isNew).toBe(true);
    expect(first.items.map((x) => x.id)).toEqual(["b", "a"]);

    const rescan = item({ id: "new", title: "OK Computer", barcode: "1", year: 1997, price: 15, priceSource: "estimate", categories: ["Alt"] });
    const second = upsert(first.items, rescan);
    expect(second.isNew).toBe(false);
    expect(second.items).toHaveLength(2);
    expect(second.saved).toMatchObject({ id: "a", price: 30, priceSource: "manual", categories: ["Rock"], year: 1997 });
  });

  it("matches by artist and album when there is no barcode", () => {
    const a = item({ id: "a", title: "Blue", artist: "Joni Mitchell", price: 10, priceSource: "estimate" });
    const out = upsert([a], item({ id: "z", title: "blue", artist: "JONI MITCHELL", price: 12, priceSource: "estimate" }));
    expect(out.items).toHaveLength(1);
    expect(out.saved.price).toBe(12);
  });
});

describe("search, categories and value", () => {
  const items = [
    item({ id: "1", title: "OK Computer", artist: "Radiohead", year: 1997, price: 15.5, categories: ["Rock", "90s"], addedAt: "2026-01-01" }),
    item({ id: "2", title: "Blue", artist: "Joni Mitchell", year: 1971, price: 22.25, categories: ["Folk"], addedAt: "2026-02-01" }),
    item({ id: "3", title: "Homogénic", artist: "Björk", categories: ["rock"], addedAt: "2026-03-01" }),
  ];

  it("totals the prices", () => {
    expect(totalValue(items)).toBe(37.75);
  });

  it("lists categories case-insensitively, most used first", () => {
    expect(allCategories(items)).toEqual([
      { name: "Rock", count: 2 },
      { name: "90s", count: 1 },
      { name: "Folk", count: 1 },
    ]);
  });

  it("searches every field, ignoring accents", () => {
    expect(filterItems(items, { query: "bjork" }).map((x) => x.id)).toEqual(["3"]);
    expect(filterItems(items, { query: "1971" }).map((x) => x.id)).toEqual(["2"]);
    expect(filterItems(items, { query: "folk joni" }).map((x) => x.id)).toEqual(["2"]);
    expect(filterItems(items, { category: "ROCK" }).map((x) => x.id)).toEqual(["3", "1"]);
    expect(filterItems(items, { sort: "price" }).map((x) => x.id)).toEqual(["2", "1", "3"]);
    expect(filterItems(items, { sort: "artist" }).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });

  it("adds a category once", () => {
    expect(withCategory(["Rock"], " rock ")).toEqual(["Rock"]);
    expect(withCategory(["Rock"], "jazz  fusion")).toEqual(["Rock", "Jazz fusion"]);
  });

  it("round-trips a backup and merges without duplicates", () => {
    const back = parseBackup(JSON.stringify({ items: [...items, { nope: 1 }] }));
    expect(back).toHaveLength(3);
    expect(mergeBackup(items.slice(0, 1), back)).toHaveLength(3);
    expect(() => parseBackup("{}")).toThrow();
  });
});

describe("saving from the listing screen", () => {
  const scanned = item({
    id: "s",
    title: "OK Computer",
    artist: "Radiohead",
    year: 1997,
    barcode: "0724384260927",
    coverUrl: "https://coverartarchive.org/x",
    price: 15.5,
    priceSource: "estimate",
    categories: ["Alternative rock"],
  });

  it("prefers the reviewed item specifics and listing price, keeping the scanned cover", () => {
    const out = itemFromListing(
      {
        title: "Radiohead OK Computer CD 1997 Parlophone Alternative Rock",
        price: 22,
        barcode: "0724384260927",
        aspects: [
          { name: "Artist", value: "Radiohead" },
          { name: "Release Title", value: "OK Computer (Remastered)" },
          { name: "Release Year", value: "2009" },
          { name: "Genre", value: "Rock" },
        ],
        imageUrls: ["https://example.com/me.jpg"],
      },
      scanned,
      now,
    );
    expect(out).toMatchObject({
      title: "OK Computer (Remastered)",
      artist: "Radiohead",
      year: 2009,
      price: 22,
      priceSource: "manual",
      coverUrl: "https://coverartarchive.org/x",
      fallbackCoverUrl: "https://example.com/me.jpg",
      categories: ["Alternative rock", "Rock"],
    });
  });

  it("works without a scan, from the listing alone", () => {
    const out = itemFromListing(
      { title: "Blue Joni Mitchell CD", price: 18, aspects: [{ name: "Artiste", value: "Joni Mitchell" }], imageUrls: ["https://e.com/a.jpg"] },
      null,
      now,
    );
    expect(out).toMatchObject({ title: "Blue Joni Mitchell CD", artist: "Joni Mitchell", coverUrl: "https://e.com/a.jpg", price: 18 });
  });

  it("updates the existing entry for the same CD", () => {
    const existing = item({ id: "old", title: "OK Computer", artist: "Radiohead", barcode: "1", categories: ["90s"], price: 10, addedAt: "2026-01-01" });
    const reviewed = item({ id: "new", title: "OK Computer", artist: "Radiohead", barcode: "1", categories: ["Rock"], price: 25, priceSource: "manual" });
    const out = saveReviewed([existing], reviewed);
    expect(out.isNew).toBe(false);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ id: "old", addedAt: "2026-01-01", price: 25, categories: ["90s", "Rock"] });
    expect(saveReviewed([], reviewed).isNew).toBe(true);
  });
});

describe("sold CDs", () => {
  const a = item({ title: "OK Computer", artist: "Radiohead", barcode: "1", price: 20, addedAt: "2026-11-01T00:00:00Z" });
  const b = item({ title: "Kid A", artist: "Radiohead", price: 15, ...markSold("2026-11-20", 18.456) });
  const c = item({ title: "Amnesiac", artist: "Radiohead", price: 12, ...markSold("2026-11-24") });

  it("marks and unmarks", () => {
    expect(markSold("2026-11-20", 18.456)).toEqual({ soldAt: "2026-11-20", soldPrice: 18.46 });
    expect(markSold("2026-11-20", Number.NaN).soldPrice).toBeUndefined();
    expect(isSold(b)).toBe(true);
    expect(isSold({ ...b, ...NOT_SOLD })).toBe(false);
    expect(today(new Date(2026, 0, 5, 23, 0))).toBe("2026-01-05");
  });

  it("filters by status and sorts by sold date", () => {
    const all = [a, b, c];
    expect(filterItems(all, { status: "unsold" }).map((i) => i.title)).toEqual(["OK Computer"]);
    expect(filterItems(all, { status: "sold", sort: "sold" }).map((i) => i.title)).toEqual(["Amnesiac", "Kid A"]);
    expect(filterItems(all, {})).toHaveLength(3);
  });

  it("totals sold price, else listed price", () => {
    expect(soldTotal([a, b, c])).toBe(30.46);
  });

  it("a new copy of a sold CD gets its own entry", () => {
    const sold = item({ title: "OK Computer", artist: "Radiohead", barcode: "1", ...markSold("2026-11-20") });
    const again = item({ id: "new", title: "OK Computer", artist: "Radiohead", barcode: "1", price: 22 });
    expect(saveReviewed([sold], again)).toMatchObject({ isNew: true });
    expect(upsert([sold], again).isNew).toBe(true);
  });

  it("keeps sold fields through a backup and skips entries already here", () => {
    const parsed = parseBackup(JSON.stringify({ items: [b, { ...a, soldAt: 5, soldPrice: "x" }] }));
    expect(parsed[0]).toMatchObject({ soldAt: "2026-11-20", soldPrice: 18.46 });
    expect(parsed[1].soldAt).toBeUndefined();
    expect(parsed[1].soldPrice).toBeUndefined();
    // Same id already on the phone (e.g. sold since the backup): not added twice.
    expect(mergeBackup([{ ...a, ...markSold("2026-11-24") }], [a])).toHaveLength(1);
  });
});

describe("saved price check on a Collection CD", () => {
  const sale = (id: string, value: number, soldDate: string) => ({
    itemId: id,
    title: "x",
    price: { value, currency: "CAD" },
    shippingCost: null,
    itemLocation: { country: "CA", postalCode: null },
    shippingDestination: null,
    condition: null,
    soldDate,
    quantitySold: 1,
    url: null,
  });
  const check = {
    current: null,
    sold: null,
    soldItems: Array.from({ length: 40 }, (_, i) => sale(`s${i}`, 10 + i, `2026-10-${String((i % 28) + 1).padStart(2, "0")}`)),
    currentItems: Array.from({ length: 35 }, (_, i) => ({ ...sale(`c${i}`, 50 - i, ""), soldDate: null })),
    unavailable: {},
    keywords: "Genesis Wind",
  };

  it("keeps the newest 30 sales and cheapest 30 listings", () => {
    const t = trimCheck(check);
    expect(t.soldItems).toHaveLength(30);
    expect(t.soldItems[0].soldDate! >= t.soldItems[29].soldDate!).toBe(true);
    expect(t.currentItems).toHaveLength(30);
    expect(t.currentItems[0].price.value).toBe(16);
  });

  it("saves the listing's price check on the CD", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    const item = itemFromListing({ title: "t", aspects: [{ name: "Release Title", value: "Wind" }], priceCheck: check }, null, now);
    expect(item.priceCheck?.soldItems).toHaveLength(30);
    expect(item.priceCheckedAt).toBe(now.toISOString());
    expect(itemFromListing({ title: "t", aspects: [] }, null, now).priceCheck).toBeUndefined();
  });
});

describe("saleRecord", () => {
  it("is what Collection sends when a CD is marked sold with a price, so future proposals learn from it", async () => {
    const { saleRecord } = await import("./collection");
    const cd = { id: "1", title: "Wind & Wuthering", artist: "Genesis", barcode: "075678154323", categories: [], addedAt: "", updatedAt: "" };
    expect(saleRecord(cd, "2026-11-27", 15)).toEqual({ barcode: "075678154323", artist: "Genesis", title: "Wind & Wuthering", soldPrice: 15, soldAt: "2026-11-27" });
    expect(saleRecord({ ...cd, barcode: undefined }, "2026-11-27", 15)).toEqual({ artist: "Genesis", title: "Wind & Wuthering", soldPrice: 15, soldAt: "2026-11-27" });
  });

  it("is nothing without a positive sale price", async () => {
    const { saleRecord } = await import("./collection");
    const cd = { id: "1", title: "Wind & Wuthering", artist: "Genesis", categories: [], addedAt: "", updatedAt: "" };
    expect(saleRecord(cd, "2026-11-27", undefined)).toBeNull();
    expect(saleRecord(cd, "2026-11-27", 0)).toBeNull();
  });
});
