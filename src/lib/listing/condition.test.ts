import { describe, expect, it } from "vitest";
import { conditionComplete, conditionSummary, cdTitle, conditionTitleSuffix, ebayConditionFromGrades } from "./condition";

describe("conditionSummary", () => {
  it("writes the seller's grades as one condition text", () => {
    expect(
      conditionSummary({ condition: "USED_VERY_GOOD", disc: "Near mint", case: "Good", booklet: "Missing", tested: true, notes: "small crack on hinge" }),
    ).toBe("Disc: near mint. Inlay / booklet: missing. Case: good. Tested: plays through without skips. Small crack on hinge.");
  });
  it("says sealed for a new CD", () => {
    expect(conditionSummary({ condition: "NEW" })).toBe("New, factory sealed.");
  });
  it("never claims tested unless the seller said so", () => {
    expect(conditionSummary({ condition: "USED_GOOD", disc: "Good" })).not.toMatch(/tested/i);
  });
});

describe("conditionComplete", () => {
  it("needs disc and inlay grades for a used CD, nothing more for a sealed one", () => {
    expect(conditionComplete({})).toBe(false);
    expect(conditionComplete({ condition: "USED_GOOD" })).toBe(false);
    expect(conditionComplete({ condition: "USED_GOOD", disc: "Good" })).toBe(false);
    expect(conditionComplete({ condition: "USED_GOOD", disc: "Good", booklet: "Missing" })).toBe(true);
    expect(conditionComplete({ condition: "NEW" })).toBe(true);
  });
});

describe("conditionTitleSuffix", () => {
  it("gives the CD and inlay grades for the title", () => {
    expect(conditionTitleSuffix({ condition: "USED_VERY_GOOD", disc: "Near mint", booklet: "Very good+" })).toBe(
      "(Disc: Near Mint / Inlay: Very Good+)",
    );
    expect(conditionTitleSuffix({ condition: "USED_GOOD", disc: "Good", booklet: "Missing" })).toBe("(Disc: Good / Inlay: Missing)");
    expect(conditionTitleSuffix({ condition: "USED_GOOD", disc: "Very good" })).toBe("(Disc: Very Good)");
    expect(conditionTitleSuffix({ condition: "NEW" })).toBe("(Sealed)");
  });

  it("builds the CD title from the album name", () => {
    const sc = { condition: "LIKE_NEW" as const, disc: "Near mint" as const, booklet: "Near mint" as const };
    expect(cdTitle("Genesis Wind & Wuthering", sc)).toBe("Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)");
    expect(cdTitle("Genesis Wind & Wuthering CD", sc)).toBe("Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)");
    expect(cdTitle("Genesis Wind & Wuthering", { condition: "NEW" })).toBe("Genesis Wind & Wuthering CD (Sealed)");
    const long = cdTitle("Some Artist With A Long Name The Very Long Album Title Deluxe", sc);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith(" CD (Disc: Near Mint / Inlay: Near Mint)")).toBe(true);
    const mint = { condition: "LIKE_NEW" as const, disc: "Mint" as const, booklet: "Mint" as const };
    expect(cdTitle("The Alan Parsons Project Tales of Mystery and Imagination: Edgar Allan Poe", mint)).toBe(
      "The Alan Parsons Project Tales of Mystery CD (Disc: Mint / Inlay: Mint)",
    );
    expect(cdTitle("Creedence Clearwater Revival The Best of Creedence Clearwater Revival", mint, 80, ["Canada", "2CD"])).toBe(
      "The Best of Creedence Clearwater Revival Canada 2CD (Disc: Mint / Inlay: Mint)",
    );
    expect(
      cdTitle("Creedence Clearwater Revival The Best of Creedence Clearwater Revival", mint, 80, [
        "Rare Canadian Press||Rare Canada||Canada",
        "2CD",
        "1993",
      ]),
    ).toBe("The Best of Creedence Clearwater Revival Canada 2CD (Disc: Mint / Inlay: Mint)");
    expect(cdTitle("Rush Moving Pictures", mint, 80, ["Rare Canadian Press||Rare Canada", "1981"])).toBe(
      "Rush Moving Pictures Rare Canadian Press 1981 CD (Disc: Mint / Inlay: Mint)",
    );
    expect(cdTitle("Tears for Fears Tears Roll Down (Greatest Hits 82–92)", mint, 80, ["Rare No Barcode||No Barcode"])).toBe(
      "Tears for Fears Tears Roll Down Rare No Barcode CD (Disc: Mint / Inlay: Mint)",
    );
    expect(cdTitle("U2 War", mint)).toBe("U2 War CD (Disc: Mint / Inlay: Mint)");
  });

  it("never uses \"Rare\" on its own, and at most once", () => {
    const mint = { condition: "LIKE_NEW" as const, disc: "Mint" as const, booklet: "Mint" as const };
    expect(cdTitle("U2 War", mint, 80, ["Rare"])).toBe("U2 War CD (Disc: Mint / Inlay: Mint)");
    expect(cdTitle("U2 War", mint, 80, ["Rare Promo", "Rare Canada"])).toBe("U2 War Rare Promo Canada CD (Disc: Mint / Inlay: Mint)");
  });

  it("fills the 80 characters with search terms that fit, never cutting the grades", () => {
    const sc = { condition: "LIKE_NEW" as const, disc: "Near mint" as const, booklet: "Near mint" as const };
    const t = cdTitle("Genesis Wind & Wuthering", sc, 80, ["1977", "Atlantic Records Remastered Edition", "Canada", "CD", "Genesis"]);
    expect(t).toBe("Genesis Wind & Wuthering 1977 Canada CD (Disc: Near Mint / Inlay: Near Mint)");
    expect(t.length).toBeLessThanOrEqual(80);
    expect(cdTitle("Sting Bring On the Night", sc, 80, ["2CD", "1986", "A&M"])).toBe(
      "Sting Bring On the Night 1986 A&M 2CD (Disc: Near Mint / Inlay: Near Mint)",
    );
    expect(cdTitle("Genesis Wind & Wuthering", { condition: "NEW" }, 80, ["(1977)", "Prog Rock"])).toBe(
      "Genesis Wind & Wuthering 1977 Prog Rock CD (Sealed)",
    );
  });
});

describe("ebayConditionFromGrades", () => {
  it("uses the weaker of disc and inlay", () => {
    expect(ebayConditionFromGrades("Mint", "Near mint")).toBe("LIKE_NEW");
    expect(ebayConditionFromGrades("Near mint", "Very good+")).toBe("USED_VERY_GOOD");
    expect(ebayConditionFromGrades("Good", "Mint")).toBe("USED_GOOD");
    expect(ebayConditionFromGrades("Very good", "Missing")).toBe("USED_GOOD");
    expect(ebayConditionFromGrades("Poor", undefined)).toBe("USED_ACCEPTABLE");
    expect(ebayConditionFromGrades(undefined, "Mint")).toBeUndefined();
  });
});

describe("conditionParams / conditionFromParams", () => {
  it("round-trips the grades through the URL", async () => {
    const { conditionParams, conditionFromParams } = await import("./condition");
    const p = conditionParams({ condition: "USED_VERY_GOOD", disc: "Near mint", booklet: "Very good+" });
    expect(p).toEqual({ disc: "Near mint", inlay: "Very good+" });
    expect(conditionFromParams((k) => p[k])).toEqual({ disc: "Near mint", booklet: "Very good+", condition: "USED_VERY_GOOD" });
    expect(conditionFromParams((k) => ({ sealed: "1" })[k])).toEqual({ condition: "NEW" });
    expect(conditionFromParams((k) => ({ disc: "Great" })[k])).toEqual({});
  });
});
