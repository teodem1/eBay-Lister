import { describe, expect, it } from "vitest";
import { nextSoldQuota, soldQuotaWarning } from "./soldLimit";

const now = new Date("2026-11-24T12:00:00Z");

describe("sold-comps allowance warning", () => {
  it("warns when the allowance is used up, until sold prices come back", () => {
    const used = nextSoldQuota({}, { soldLimitReached: true }, now);
    expect(soldQuotaWarning(used, now)).toEqual({ kind: "limit" });
    const back = nextSoldQuota(used, { sold: {} }, now);
    expect(soldQuotaWarning(back, now)).toBeNull();
  });

  it("warns when few lookups are left", () => {
    expect(soldQuotaWarning(nextSoldQuota({}, { soldRemaining: 7, sold: {} }, now), now)).toEqual({ kind: "low", remaining: 7 });
    expect(soldQuotaWarning(nextSoldQuota({}, { soldRemaining: 40, sold: {} }, now), now)).toBeNull();
  });

  it("drops a used-up mark after a month", () => {
    const old = { limitAt: "2026-10-01T00:00:00Z", remaining: 0 };
    expect(soldQuotaWarning({ limitAt: old.limitAt }, now)).toBeNull();
  });
});
