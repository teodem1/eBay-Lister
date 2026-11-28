import { describe, expect, it } from "vitest";
import type { BatchRun, Proposal } from "@/lib/listing/types";
import { priceChange, proposalRows, runLabel } from "./batchView";

const NOW = new Date("2026-11-28T12:00:00.000Z");
const run = (over: Partial<BatchRun>): BatchRun => ({
  id: "r1",
  startedAt: "2026-11-28T11:57:00.000Z",
  fiveHour: 20,
  weekly: 10,
  skus: ["A", "B"],
  status: "started",
  ...over,
});
const p = (over: Partial<Proposal>): Proposal => ({
  sku: "A",
  runId: "r1",
  createdAt: "2026-11-28T11:00:00.000Z",
  snapshot: { title: "T", price: 10 },
  title: "T",
  addAspects: {},
  appendHtml: "",
  price: 10,
  pendingPrice: null,
  evidence: "",
  engagement: { level: "normal", sold: 1, listed: 1, monthsOfSupply: 1, reason: "" },
  flags: [],
  status: "open",
  ...over,
});

describe("runLabel", () => {
  it("says how long a run has been going, and how it ended", () => {
    expect(runLabel(run({}), NOW)).toBe("Running, started 3 min ago (2 CDs)");
    expect(runLabel(run({ status: "done" }), NOW)).toBe("Done (2 CDs)");
    expect(runLabel(run({ status: "failed", reason: "Usage too high." }), NOW)).toBe("Stopped: Usage too high.");
    expect(runLabel(run({ status: "no_answer" }), NOW)).toBe("No answer after 2 hours");
  });
});

describe("proposalRows", () => {
  it("puts open proposals first and the rest under recent", () => {
    const rows = proposalRows([p({ sku: "A", status: "applied" }), p({ sku: "B" }), p({ sku: "C", status: "stale" })]);
    expect(rows.open.map((x) => x.sku)).toEqual(["B"]);
    expect(rows.recent.map((x) => x.sku)).toEqual(["A", "C"]);
  });
});

describe("priceChange", () => {
  it("flags a change over 50% either way", () => {
    expect(priceChange(p({ snapshot: { title: "T", price: 10 }, price: 16 }))).toEqual({ from: 10, to: 16, flag: "+60%" });
    expect(priceChange(p({ snapshot: { title: "T", price: 10 }, price: 4 }))).toEqual({ from: 10, to: 4, flag: "-60%" });
    expect(priceChange(p({ snapshot: { title: "T", price: 10 }, price: 12 }))).toEqual({ from: 10, to: 12 });
    expect(priceChange(p({ snapshot: { title: "T", price: null }, price: 12 }))).toEqual({ from: null, to: 12 });
  });
});
