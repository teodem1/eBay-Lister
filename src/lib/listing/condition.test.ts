import { describe, expect, it } from "vitest";
import { conditionComplete, conditionSummary } from "./condition";

describe("conditionSummary", () => {
  it("writes the seller's grades as one condition text", () => {
    expect(
      conditionSummary({ condition: "USED_VERY_GOOD", disc: "Near mint", case: "Good", booklet: "Missing", tested: true, notes: "small crack on hinge" }),
    ).toBe("Disc: near mint. Case: good. Booklet / artwork: missing. Tested: plays through without skips. Small crack on hinge.");
  });
  it("says sealed for a new CD", () => {
    expect(conditionSummary({ condition: "NEW" })).toBe("New, factory sealed.");
  });
  it("never claims tested unless the seller said so", () => {
    expect(conditionSummary({ condition: "USED_GOOD", disc: "Good" })).not.toMatch(/tested/i);
  });
});

describe("conditionComplete", () => {
  it("needs a disc grade for a used CD, nothing more for a sealed one", () => {
    expect(conditionComplete({})).toBe(false);
    expect(conditionComplete({ condition: "USED_GOOD" })).toBe(false);
    expect(conditionComplete({ condition: "USED_GOOD", disc: "Good" })).toBe(true);
    expect(conditionComplete({ condition: "NEW" })).toBe(true);
  });
});
