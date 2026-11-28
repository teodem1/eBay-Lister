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
  it("doesn't read format words in the album name as the seller asking for vinyl or tapes", async () => {
    const { cdKeywords, onlyCds } = await import("./version");
    expect(cdKeywords("Electric Light Orchestra A New World Record", { exclude: true })).toBe(
      "Electric Light Orchestra A New World Record CD -vinyl -lp -cassette -tape",
    );
    expect(cdKeywords("Bob Dylan The Basement Tapes", { exclude: true })).toBe(
      "Bob Dylan The Basement Tapes CD -vinyl -lp -cassette -record",
    );
    const elo = onlyCds(
      [
        c("ELO A New World Record LP Vinyl 1976 Jet", "US"),
        c("Electric Light Orchestra - A New World Record CD Epic Canada", "CA"),
        c("ELO A New World Record Cassette", "US"),
      ],
      "Electric Light Orchestra A New World Record",
    ).map((i) => i.title);
    expect(elo).toEqual(["Electric Light Orchestra - A New World Record CD Epic Canada"]);
    const dylan = onlyCds(
      [c("Bob Dylan The Basement Tapes 2 Cassette Tapes", "US"), c("Bob Dylan & The Band The Basement Tapes CD", "CA")],
      "Bob Dylan The Basement Tapes",
    ).map((i) => i.title);
    expect(dylan).toEqual(["Bob Dylan & The Band The Basement Tapes CD"]);
    const purple = onlyCds(
      [c("Deep Purple Made in Japan CD", "CA"), c("Deep Purple Made in Japan Japanese SHM-CD OBI", "JP")],
      "Deep Purple Made in Japan",
    ).map((i) => i.title);
    expect(purple).toEqual(["Deep Purple Made in Japan CD"]);
  });
});

describe("sameCondition", () => {
  const cc = (condition: string, price: number) => ({ ...c("Wind & Wuthering CD", "CA", price), condition }) as Comparable;
  const items = [
    cc("Brand New", 30),
    cc("New", 28),
    cc("Brand New", 32),
    cc("Pre-Owned", 12),
    cc("Very Good", 14),
    cc("Very Good", 15),
    cc("Very Good", 13),
    cc("Good", 9),
  ];
  it("keeps sealed copies for a sealed CD", async () => {
    const { sameCondition } = await import("./version");
    expect(sameCondition(items, "NEW").map((i) => i.price.value)).toEqual([30, 28, 32]);
  });
  it("keeps the same grade when there are enough, else all used copies", async () => {
    const { sameCondition } = await import("./version");
    expect(sameCondition(items, "USED_VERY_GOOD").map((i) => i.price.value)).toEqual([14, 15, 13]);
    expect(sameCondition(items, "USED_GOOD").map((i) => i.price.value)).toEqual([12, 14, 15, 13, 9]);
    expect(sameCondition(items, undefined)).toHaveLength(8);
  });
});

describe("searchName", () => {
  it("drops a Various Artists prefix, bracketed parts and a subtitle after a colon", async () => {
    const { searchName } = await import("./version");
    const cases: Record<string, string> = {
      "Various Artists Baraka: Music From the Original Motion Picture Soundtrack": "Baraka",
      "James Horner Braveheart (Original Motion Picture Soundtrack)": "James Horner Braveheart",
      "John Williams Schindler's List: Original Motion Picture Soundtrack": "John Williams Schindler's List",
      "Genesis Wind & Wuthering [Remastered]": "Genesis Wind & Wuthering",
      "Jean-Claude Petit Cyrano de Bergerac": "Jean-Claude Petit Cyrano de Bergerac",
      "Various Artists": "Various Artists",
      ": (x)": ": (x)",
    };
    for (const [long, short] of Object.entries(cases)) expect(searchName(long), long).toBe(short);
  });

  it("is what CD searches send, unless the name asks for another format", async () => {
    const { cdKeywords } = await import("./version");
    expect(cdKeywords("James Horner Braveheart (Original Motion Picture Soundtrack)")).toBe("James Horner Braveheart CD");
    expect(cdKeywords("Pink Floyd The Wall (Vinyl Edition)")).toBe("Pink Floyd The Wall (Vinyl Edition)");
  });
});
