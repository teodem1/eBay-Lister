import { describe, expect, it } from "vitest";
import { WriteConflict, type Backend } from "../comps/store";
import { readIndex, readLive, readProposals, readRun, readRuns, saveRun, updateIndex, updateProposals, writeIndex, writeLive, writeProposals } from "./store";
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

  it("keeps proposals in one file by SKU", async () => {
    const { backend, files } = memory();
    expect(await readProposals(backend)).toEqual({});
    await writeProposals(backend, { "BC-1": proposal }, new Date("2026-11-28T00:00:00.000Z"));
    expect(Object.keys(files)).toEqual(["batch/proposals.json"]);
    expect((await readProposals(backend))["BC-1"]).toEqual(proposal);
  });

  it("drops proposals done more than 7 days ago, keeping open ones", async () => {
    const { backend } = memory();
    const old = { ...proposal, sku: "BC-2", status: "applied" as const, createdAt: "2026-11-01T00:00:00.000Z" };
    const openOld = { ...proposal, sku: "BC-3", createdAt: "2026-11-01T00:00:00.000Z" };
    await writeProposals(backend, { "BC-1": proposal, "BC-2": old, "BC-3": openOld }, new Date("2026-11-28T00:00:00.000Z"));
    expect(Object.keys(await readProposals(backend)).sort()).toEqual(["BC-1", "BC-3"]);
  });

  it("caches the live SKUs", async () => {
    const { backend } = memory();
    expect(await readLive(backend)).toEqual([]);
    await writeLive(backend, ["A", "B"]);
    expect(await readLive(backend)).toEqual(["A", "B"]);
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

/** A store with file versions: a write with an old version is refused, as Vercel Blob's ifMatch does. */
function versioned(files: Record<string, string> = {}) {
  const versions: Record<string, number> = {};
  let beforeWrite: (() => void) | null = null;
  const backend: Backend = {
    read: async (p) => files[p] ?? null,
    readTagged: async (p) => (p in files ? { text: files[p], etag: String(versions[p] ?? 0) } : null),
    write: async (p, b, opts) => {
      const hook = beforeWrite;
      beforeWrite = null;
      hook?.();
      if (opts?.ifMatch !== undefined && opts.ifMatch !== String(versions[p] ?? 0)) throw new WriteConflict(p);
      files[p] = b;
      versions[p] = (versions[p] ?? 0) + 1;
    },
  };
  return { backend, files, onNextWrite: (f: () => void) => (beforeWrite = f), versions };
}

describe("safe updates", () => {
  it("redoes a change when another writer saved the file in between, keeping both changes", async () => {
    const { backend, files, onNextWrite, versions } = versioned();
    await writeIndex(backend, { A: { status: "open", updatedAt: "t" } });
    versions["batch/index.json"] = 1;
    onNextWrite(() => {
      // Another run reserves B while this change is being written.
      const cur = JSON.parse(files["batch/index.json"]);
      files["batch/index.json"] = JSON.stringify({ ...cur, B: { status: "in_progress", updatedAt: "t" } });
      versions["batch/index.json"] += 1;
    });
    await updateIndex(backend, (index) => ({ ...index, A: { status: "dismissed", updatedAt: "t2" } }));
    expect(JSON.parse(files["batch/index.json"])).toEqual({ A: { status: "dismissed", updatedAt: "t2" }, B: { status: "in_progress", updatedAt: "t" } });
  });

  it("writes nothing when the change returns undefined", async () => {
    const { backend, files } = versioned();
    await updateProposals(backend, new Date(), () => undefined);
    expect(files["batch/proposals.json"]).toBeUndefined();
  });

  it("gives up after 5 refused writes", async () => {
    const backend: Backend = {
      read: async () => "{}",
      readTagged: async () => ({ text: "{}", etag: "1" }),
      write: async (p) => {
        throw new WriteConflict(p);
      },
    };
    await expect(updateIndex(backend, () => ({}))).rejects.toBeInstanceOf(WriteConflict);
  });
});
