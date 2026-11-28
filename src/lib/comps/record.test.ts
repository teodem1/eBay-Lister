import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import { matchesEdition } from "../pricing/edition";
import { filterLookup, lookupKeys, type SoldQuery } from "./record";

const c = (itemId: string, title: string, value: number, condition: string | null = null): Comparable => ({
  itemId,
  title,
  price: { value, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: null, postalCode: null },
  shippingDestination: null,
  condition,
  soldDate: null,
  quantitySold: 1,
  url: null,
});

describe("lookupKeys", () => {
  it("keys a barcoded CD by its bare UPC only, so another pressing's by-name result is never used", () => {
    expect(lookupKeys({ barcode: "0075678154323", name: "Genesis Wind & Wuthering" })).toEqual([
      "comps/upc/075678154323.json",
    ]);
  });

  it("keys a CD without a usable barcode by its name", () => {
    expect(lookupKeys({ name: "Genesis Wind & Wuthering" })).toEqual(["comps/name/genesis-wind-wuthering.json"]);
    expect(lookupKeys({ barcode: "123", name: "Genesis Wind & Wuthering" })).toEqual([
      "comps/name/genesis-wind-wuthering.json",
    ]);
  });

  it("strips accents and punctuation from the name", () => {
    expect(lookupKeys({ name: "Amélie  Poulain!" })).toEqual(["comps/name/amelie-poulain.json"]);
  });

  it("gives no key for a symbol-only name or a too-short barcode", () => {
    expect(lookupKeys({ name: "???" })).toEqual([]);
    expect(lookupKeys({ barcode: "123" })).toEqual([]);
    expect(lookupKeys({ name: "   " })).toEqual([]);
    expect(lookupKeys({})).toEqual([]);
  });

  it("rejects a barcode longer than 14 digits", () => {
    expect(lookupKeys({ barcode: "123456789012345" })).toEqual([]);
  });

  it("caps the name slug at 120 characters", () => {
    const [key] = lookupKeys({ name: "a".repeat(200) });
    expect(key).toBe(`comps/name/${"a".repeat(120)}.json`);
  });
});

describe("matchesEdition", () => {
  it("reads the edition from a sold title", () => {
    expect(matchesEdition("U2 War CD Canada", "canadian")).toBe(true);
    expect(matchesEdition("U2 War CD", "canadian")).toBe(false);
    expect(matchesEdition("U2 War no-barcode CD", "no_barcode")).toBe(true);
  });
});

describe("filterLookup", () => {
  const first: SoldQuery = { by: "barcode", items: [c("x1", "Genesis Wind & Wuthering CD Canada", 30)] };

  it("filters only the last query's items", () => {
    const last: SoldQuery = { by: "keywords", items: [c("a", "Genesis Wind & Wuthering CD", 10)] };
    const f = filterLookup([first, last], "Genesis Wind & Wuthering");
    expect(f.cdOnly).toEqual(["a"]);
    expect(f.detail.canadian).toEqual([]);
  });

  it("drops a vinyl copy from the CD-only set", () => {
    const q: SoldQuery = {
      by: "keywords",
      items: [c("cd", "Genesis Wind & Wuthering CD", 10), c("lp", "Genesis Wind & Wuthering Vinyl LP", 40)],
    };
    expect(filterLookup([q], "Genesis Wind & Wuthering").cdOnly).toEqual(["cd"]);
  });

  it("keeps only like-new sales when 3 or more are like new", () => {
    const q: SoldQuery = {
      by: "keywords",
      items: [
        c("ln1", "Genesis Wind & Wuthering CD", 12, "Like New"),
        c("ln2", "Genesis Wind & Wuthering CD", 13, "Like New"),
        c("ln3", "Genesis Wind & Wuthering CD", 14, "Like New"),
        c("g1", "Genesis Wind & Wuthering CD", 6, "Good"),
      ],
    };
    const f = filterLookup([q], "Genesis Wind & Wuthering", "LIKE_NEW");
    expect(f.cdOnly).toEqual(["ln1", "ln2", "ln3", "g1"]);
    expect(f.sameGrade).toEqual(["ln1", "ln2", "ln3"]);
  });

  it("lists a Canadian-titled sale under detail.canadian", () => {
    const q: SoldQuery = {
      by: "keywords",
      items: [c("ca", "Genesis Wind & Wuthering CD Canada", 20), c("us", "Genesis Wind & Wuthering CD", 10)],
    };
    const f = filterLookup([q], "Genesis Wind & Wuthering");
    expect(f.detail.canadian).toEqual(["ca"]);
    expect(f.detail.no_barcode).toEqual([]);
    expect(Object.keys(f.detail).sort()).toEqual(
      ["canadian", "club", "early_press", "japan", "limited", "no_barcode", "promo"].sort(),
    );
  });

  it("gives empty sets when there are no queries", () => {
    const f = filterLookup([]);
    expect(f.cdOnly).toEqual([]);
    expect(f.sameGrade).toEqual([]);
    expect(f.detail.canadian).toEqual([]);
  });
});
