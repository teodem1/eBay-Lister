import { describe, expect, it } from "vitest";
import type { Backend } from "../comps/store";
import { readIndex, readProposal, readRun, readRuns, saveProposal, saveRun, writeIndex } from "./store";
import type { BatchRun, Proposal } from "./types";

function memory(files: Record<string, string> = {}) {
  const backend: Backend = {
    read: async (p) => files[p] ?? null,
    write: async (p, b) => void (files[p] = b),
  };
  return { backend, files };
}

const proposal: Proposal = {
  sku: "BC-1",
  runId: "r1",
  createdAt: "2026-11-28T00:00:00.000Z",
  snapshot: { title: "Old", price: 10 },
  title: "New",
  addAspects: {},
  appendHtml: "",
  price: 12,
  pendingPrice: null,
  evidence: "6 sales",
  engagement: { level: "normal", sold: 6, listed: 8, monthsOfSupply: 7, reason: "r" },
  flags: [],
  status: "open",
};

const run = (id: string): BatchRun => ({
  id,
  startedAt: "2026-11-28T00:00:00.000Z",
  fiveHour: 20,
  weekly: 10,
  skus: ["BC-1"],
  status: "started",
});

describe("batch store", () => {
  it("reads back the index it wrote, and an empty index when none is stored", async () => {
    const { backend } = memory();
    expect(await readIndex(backend)).toEqual({});
    await writeIndex(backend, { "BC-1": { status: "open", runId: "r1", updatedAt: "2026-11-28T00:00:00.000Z" } });
    expect((await readIndex(backend))["BC-1"].status).toBe("open");
  });

  it("rejects when storage cannot be read, never reading it as empty", async () => {
    const backend: Backend = { read: () => Promise.reject(new Error("blob down")), write: async () => {} };
    await expect(readIndex(backend)).rejects.toThrow("blob down");
    await expect(readRuns(backend)).rejects.toThrow("blob down");
  });

  it("rejects an unreadable index file", async () => {
    const { backend } = memory({ "batch/index.json": "{oops" });
    await expect(readIndex(backend)).rejects.toThrow();
  });

  it("round-trips a proposal under its SKU", async () => {
    const { backend, files } = memory();
    await saveProposal(backend, proposal);
    expect(Object.keys(files)).toEqual(["batch/proposals/BC-1.json"]);
    expect(await readProposal(backend, "BC-1")).toEqual(proposal);
    expect(await readProposal(backend, "BC-2")).toBeNull();
  });

  it("keeps runs in one file, the last 50", async () => {
    const { backend, files } = memory();
    for (let i = 0; i < 55; i++) await saveRun(backend, run(`r${i}`));
    const runs = await readRuns(backend);
    expect(runs).toHaveLength(50);
    expect(runs[0].id).toBe("r54");
    expect(await readRun(backend, "r54")).toMatchObject({ id: "r54" });
    expect(await readRun(backend, "r0")).toBeNull();
    expect(Object.keys(files)).toEqual(["batch/runs.json"]);
  });

  it("updates a run in place", async () => {
    const { backend } = memory();
    await saveRun(backend, run("r1"));
    await saveRun(backend, { ...run("r1"), status: "done" });
    const runs = await readRuns(backend);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("done");
  });
});
