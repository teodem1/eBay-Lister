import { describe, expect, it } from "vitest";
import { estimateFits, expireRuns, nextDue, nextSkus, release, reserve } from "./queue";
import type { BatchIndex, BatchRun } from "./types";

const NOW = new Date("2026-11-28T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("nextSkus", () => {
  it("takes never-proposed listings first, newest first (the reverse of eBay's order)", () => {
    expect(nextSkus(["A", "B", "C"], {}, NOW, 2)).toEqual(["C", "B"]);
  });

  it("then failed and stale ones, then listings 60 days or more after their last proposal, oldest first", () => {
    const index: BatchIndex = {
      A: { status: "applied", updatedAt: daysAgo(70) },
      B: { status: "dismissed", updatedAt: daysAgo(90) },
      C: { status: "failed", updatedAt: daysAgo(1) },
      D: { status: "stale", updatedAt: daysAgo(2) },
      E: { status: "open", updatedAt: daysAgo(61) },
      F: { status: "applied", updatedAt: daysAgo(10) },
      G: { status: "open", updatedAt: daysAgo(5) },
      H: { status: "in_progress", runId: "r1", updatedAt: daysAgo(0) },
    };
    expect(nextSkus(["A", "B", "C", "D", "E", "F", "G", "H", "N"], index, NOW, 20)).toEqual(["N", "D", "C", "B", "A", "E"]);
  });

  it("never takes a listing that is no longer live (sold)", () => {
    expect(nextSkus(["A"], { Z: { status: "failed", updatedAt: daysAgo(1) } }, NOW, 20)).toEqual(["A"]);
  });
});

describe("reserve and release", () => {
  it("gives two runs different listings", () => {
    const live = ["A", "B", "C", "D"];
    const first = nextSkus(live, {}, NOW, 2);
    const index = reserve({}, first, "r1", NOW);
    const second = nextSkus(live, index, NOW, 2);
    expect(second.some((s) => first.includes(s))).toBe(false);
    expect(index[first[0]]).toMatchObject({ status: "in_progress", runId: "r1" });
  });

  it("puts a released listing back as it was", () => {
    const old: BatchIndex = { A: { status: "applied", updatedAt: daysAgo(70) } };
    const reserved = reserve(old, ["A", "N"], "r1", NOW);
    const back = release(reserved, ["A", "N"]);
    expect(back).toEqual(old);
  });
});

describe("nextDue", () => {
  it("is the earliest date a listing comes back, when nothing is due now", () => {
    const index: BatchIndex = {
      A: { status: "applied", updatedAt: daysAgo(10) },
      B: { status: "dismissed", updatedAt: daysAgo(30) },
    };
    expect(nextDue(["A", "B"], index, NOW)).toBe(new Date(new Date(daysAgo(30)).getTime() + 60 * 86_400_000).toISOString());
  });

  it("is null when something is due now", () => {
    expect(nextDue(["A"], {}, NOW)).toBeNull();
  });
});

describe("estimateFits", () => {
  it("fits a full batch well under the stop", () => {
    expect(estimateFits(22, 18, 0, 20).batch).toBe(20);
  });

  it("counts the batches still running", () => {
    const r = estimateFits(40, 18, 40, 20);
    expect(r.batch).toBe(0);
    expect(r.reason).toContain("80%");
    expect(estimateFits(50, 18, 20, 20).batch).toBe(9);
  });
});

describe("expireRuns", () => {
  const run = (id: string, minutes: number): BatchRun => ({
    id,
    startedAt: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
    fiveHour: 10,
    weekly: 10,
    skus: id === "old" ? ["A", "B"] : ["C"],
    status: "started",
  });

  it("returns listings held by a run that has no record, once 2 hours old", () => {
    const old = new Date(NOW.getTime() - 121 * 60_000);
    const index = { ...reserve({}, ["X"], "lost", old), ...reserve({}, ["Y"], "lost", NOW) };
    const out = expireRuns([], index, NOW);
    expect(out.index.X).toBeUndefined();
    expect(out.index.Y.status).toBe("in_progress");
  });

  it("marks a run with no answer after 2 hours and returns only its unfinished listings", () => {
    const index = {
      ...reserve({}, ["A"], "old", NOW),
      B: { status: "open" as const, runId: "old", updatedAt: daysAgo(0) },
      ...reserve({}, ["C"], "new", NOW),
    };
    const out = expireRuns([run("old", 121), run("new", 30)], index, NOW);
    expect(out.runs.map((r) => r.status)).toEqual(["no_answer", "started"]);
    expect(out.index.A).toBeUndefined();
    expect(out.index.B.status).toBe("open");
    expect(out.index.C.status).toBe("in_progress");
  });
});
