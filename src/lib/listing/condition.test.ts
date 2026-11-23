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
