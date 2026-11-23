import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import { isHomeCopy, otherVersion, selectSameVersion } from "./version";

const c = (title: string, country: string | null, price = 20): Comparable =>
  ({
    itemId: title,
    title,
    price: { value: price, currency: "CAD" },
    shippingCost: null,
    itemLocation: { country, postalCode: null },
    shippingDestination: "CA",
    condition: "Used",
    soldDate: "2026-11-01",
    quantitySold: 1,
  }) as unknown as Comparable;

describe("otherVersion", () => {
  it("spots Japanese, vinyl, signed and lots", () => {
    expect(otherVersion("PINK FLOYD THE DIVISION BELL JAPAN MINI LP")).toBe("Japanese");
    expect(otherVersion("Radiohead OK Computer 2LP vinyl")).toBe("vinyl");
    expect(otherVersion("Radiohead JSA Fully Signed Autograph CD")).toBe("signed");
    expect(otherVersion("Radiohead OK Computer Kid A CD Lot")).toBe("lot");
    expect(otherVersion("Pink Floyd The Division Bell CD")).toBeNull();
  });
  it("keeps a version the seller's own text names", () => {
    expect(otherVersion("Division Bell Japan OBI CD", "Pink Floyd Division Bell Japan")).toBeNull();
  });
});

describe("isHomeCopy", () => {
  it("counts copies sold from Canada or titled Canadian", () => {
    expect(isHomeCopy(c("Division Bell CD", "CA"), "CA")).toBe(true);
    expect(isHomeCopy(c("Division Bell CD Canadian press", "US"), "CA")).toBe(true);
    expect(isHomeCopy(c("Division Bell CD", "US"), "CA")).toBe(false);
  });
});

describe("selectSameVersion", () => {
  const items = [
    c("Division Bell CD", "CA", 18),
    c("Division Bell CD", "CA", 21),
    c("Division Bell CD Made in Canada", "US", 19),
    c("Division Bell CD", "US", 26),
    c("Division Bell JAPAN mini LP", "JP", 258),
    c("Division Bell CD", "GB", 41),
  ];
  it("prices from Canadian copies and leaves other versions out", () => {
    const r = selectSameVersion(items, { keywords: "Pink Floyd Division Bell", homeCountry: "CA", unit: "sales" });
    expect(r.items.map((i) => i.price.value)).toEqual([18, 21, 19]);
    expect(r.homeCountry).toBe("CA");
    expect(r.otherVersionsLeftOut).toBe(1);
    expect(r.notes.join(" ")).toContain("Based on 3 Canadian copies");
  });
  it("uses every copy when there are too few Canadian ones", () => {
    const r = selectSameVersion(items.slice(3), { homeCountry: "CA", unit: "sales" });
    expect(r.homeCountry).toBeNull();
    expect(r.notes.join(" ")).toContain("Only 0 Canadian sales");
  });
});

describe("CD-only search", () => {
  it("adds CD and excludes other formats", async () => {
    const { cdKeywords, onlyCds } = await import("./version");
    expect(cdKeywords("Genesis Wind & Wuthering")).toBe("Genesis Wind & Wuthering CD");
    expect(cdKeywords("Genesis Wind & Wuthering CD", { exclude: true })).toBe(
      "Genesis Wind & Wuthering CD -vinyl -lp -cassette -tape -record",
    );
    expect(cdKeywords("Genesis Wind & Wuthering vinyl LP", { exclude: true })).toBe("Genesis Wind & Wuthering vinyl LP");
    const titles = onlyCds(
      [
        c("Genesis Wind & Wuthering 1976 Cassette", "US"),
        c("Genesis, Wind & Wuthering Record VG+/VG++, Atco", "US"),
        c("CASSETTE TAPES 60s 70's 80's 90's MADONNA", "US"),
        c("GENESIS - Wind & Wuthering 82690-2 ATCO CD", "CA"),
      ],
      "Genesis Wind & Wuthering",
    ).map((i) => i.title);
    expect(titles).toEqual(["GENESIS - Wind & Wuthering 82690-2 ATCO CD"]);
  });
});
