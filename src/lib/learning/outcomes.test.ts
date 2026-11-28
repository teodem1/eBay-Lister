import { describe, expect, it } from "vitest";
import { engagementLevel, learnedPosition, MIN_LEVEL_SALES, percentileOf, type SaleOutcome } from "./outcomes";

describe("percentileOf", () => {
  it("places a sale price among the stored sales (0-100), leaving out junk sales", () => {
    expect(percentileOf(15, [10, 12, 14, 16, 18])).toBe(60);
    expect(percentileOf(14, [10, 12, 14, 16, 18])).toBe(50); // an equal sale counts half
    expect(percentileOf(30, [10, 12, 14])).toBe(100);
    expect(percentileOf(5, [0.01, 0.5, 10, 12, 14])).toBe(0); // under C$1 left out
  });

  it("is null with fewer than 3 usable sales", () => {
    expect(percentileOf(15, [10, 12])).toBeNull();
  });
});

describe("engagementLevel", () => {
  const dated = (...daysAgo: number[]) =>
    daysAgo.map((d) => ({ soldDate: new Date(Date.UTC(2026, 10, 28) - d * 86_400_000).toISOString().slice(0, 10) }));
  const saved = "2026-11-28T00:00:00.000Z";

  it("matches the plugin: months of supply 3 or less is high, 12 or more is low", () => {
    expect(engagementLevel(dated(5, 20, 40, 60, 80, 100), saved, 3)).toBe("high");
    expect(engagementLevel(dated(30, 200, 360), saved, 40)).toBe("low");
    expect(engagementLevel(dated(10, 40, 70, 100, 130, 160), saved, 8)).toBe("normal");
    expect(engagementLevel([], saved, 5)).toBe("low");
    expect(engagementLevel([], saved, 0)).toBe("normal");
  });
});

describe("learnedPosition", () => {
  const outcome = (key: string, percentile: number | null, level: SaleOutcome["level"], soldAt = "2026-11-01"): SaleOutcome => ({
    key,
    name: key,
    soldAt,
    soldPrice: 20,
    percentile,
    salesCount: 6,
    median: 15,
    listedNow: 4,
    level,
    recordedAt: soldAt,
  });

  it("calibrates a level from its average once it has enough sales, kept between 10 and 90", () => {
    const low = Array.from({ length: MIN_LEVEL_SALES }, (_, i) => outcome(`K${i}`, 40 + i * 2, "low"));
    expect(MIN_LEVEL_SALES).toBe(5);
    expect(learnedPosition(low, "low")).toEqual({ percentile: 44, n: 5 });
    expect(learnedPosition(low.slice(1), "low")).toBeNull();
    expect(learnedPosition(low, "high")).toBeNull();
    const extreme = Array.from({ length: 5 }, (_, i) => outcome(`X${i}`, 100, "high"));
    expect(learnedPosition(extreme, "high")?.percentile).toBe(90);
  });

  it("ignores sales whose percentile could not be computed", () => {
    expect(learnedPosition(Array.from({ length: 5 }, (_, i) => outcome(`N${i}`, null, "low")), "low")).toBeNull();
  });
});
