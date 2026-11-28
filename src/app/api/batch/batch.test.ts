import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "../../../lib/comps/store";
import type { BatchIndex, BatchRun, Proposal } from "../../../lib/liveBatch/types";

let files: Record<string, string> = {};
let failReads = false;
const backend: Backend = {
  read: async (p) => {
    if (failReads) throw new Error("blob down");
    return files[p] ?? null;
  },
  write: async (p, b) => void (files[p] = b),
};
const fireRoutine = vi.fn();
const listLiveListings = vi.fn();
const applyProposal = vi.fn();

vi.mock("@/lib/comps/store", async (orig) => ({ ...(await orig<object>()), blobBackend: () => backend }));
vi.mock("@/lib/liveBatch/fire", () => ({ fireRoutine: (...a: unknown[]) => fireRoutine(...a) }));
vi.mock("@/lib/ebay/refreshListings", async (orig) => ({ ...(await orig<object>()), listLiveListings: (...a: unknown[]) => listLiveListings(...a) }));
vi.mock("@/lib/liveBatch/apply", () => ({ applyProposal: (...a: unknown[]) => applyProposal(...a) }));
vi.mock("@/app/api/listing/refresh/shared", () => ({
  sellClient: () => ({ client: {}, config: { bestOfferMinPercent: 70, currency: "CAD" } }),
  errorResponse: (e: Error) => Response.json({ error: e.message }, { status: 502 }),
}));

const { GET: getBatch } = await import("./route");
const { POST: postRun } = await import("./run/route");
const { GET: getRunRoute, POST: postRunRoute } = await import("./runs/[id]/route");
const { POST: postProposals } = await import("./proposals/route");
const { POST: postApply } = await import("./apply/route");
const { POST: postDismiss } = await import("./dismiss/route");

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const req = (path: string, init?: RequestInit) => new Request(`http://x${path}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const read = <T,>(path: string): T => JSON.parse(files[path]) as T;
const index = () => read<BatchIndex>("batch/index.json");

const live = (n: number) => ({ listings: Array.from({ length: n }, (_, i) => ({ sku: `S${i}`, title: `T${i}`, price: 10 })), total: n });
const run = (body = { fiveHour: 20, weekly: 10 }) => postRun(req("/api/batch/run", json(body)));

const proposal = (sku: string, runId: string): Proposal => ({
  sku,
  runId,
  createdAt: "2026-11-28T00:00:00.000Z",
  snapshot: { title: "T", price: 10 },
  title: "T new",
  addAspects: {},
  appendHtml: "",
  price: 11,
  pendingPrice: null,
  evidence: "e",
  engagement: { level: "normal", sold: 3, listed: 4, monthsOfSupply: 5, reason: "r" },
  flags: [],
  status: "open",
});

beforeEach(() => {
  vi.stubEnv("ROUTINE_FIRE_URL", "https://api.anthropic.com/v1/claude_code/routines/trig_X/fire");
  vi.stubEnv("ROUTINE_FIRE_TOKEN", "test-token");
  files = {};
  failReads = false;
  fireRoutine.mockReset().mockResolvedValue({ sessionId: "s1", sessionUrl: "https://claude.ai/code/session_1" });
  listLiveListings.mockReset().mockResolvedValue(live(30));
  applyProposal.mockReset();
});

describe("POST /api/batch/run", () => {
  it("reserves 20 listings and fires the task with the run id and percentages, never the token", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    const { run: r } = (await res.json()) as { run: BatchRun };
    expect(r.skus).toHaveLength(20);
    expect(r.sessionUrl).toBe("https://claude.ai/code/session_1");
    expect(Object.values(index()).filter((e) => e.status === "in_progress")).toHaveLength(20);
    const [, text] = fireRoutine.mock.calls[0];
    expect(JSON.parse(text)).toEqual({ runId: r.id, fiveHour: 20, weekly: 10 });
  });

  it("gives a second run different listings", async () => {
    const a = ((await (await run()).json()) as { run: BatchRun }).run;
    const b = ((await (await run()).json()) as { run: BatchRun }).run;
    expect(b.skus.some((s) => a.skus.includes(s))).toBe(false);
    expect(b.skus).toHaveLength(10);
  });

  it("warns and starts nothing when usage would reach 80%", async () => {
    const res = await run({ fiveHour: 79, weekly: 10 });
    expect(res.status).toBe(409);
    expect((await res.json()).warning).toContain("80%");
    expect(fireRoutine).not.toHaveBeenCalled();
    expect(files["batch/index.json"]).toBeUndefined();
  });

  it("counts the CDs of runs still going", async () => {
    const first = ((await (await run({ fiveHour: 60, weekly: 10 })).json()) as { run: BatchRun }).run;
    expect(first.skus).toHaveLength(19);
    const res = await run({ fiveHour: 60, weekly: 10 });
    expect(res.status).toBe(409);
  });

  it("releases the reservation when the task cannot start", async () => {
    fireRoutine.mockRejectedValue(new Error("The batch could not start (status 500)."));
    const res = await run();
    expect(res.status).toBe(502);
    expect(Object.values(index()).filter((e) => e.status === "in_progress")).toHaveLength(0);
  });

  it("answers 502 and fires nothing when storage cannot be read", async () => {
    failReads = true;
    expect((await run()).status).toBe(502);
    expect(fireRoutine).not.toHaveBeenCalled();
  });

  it("says when nothing is due", async () => {
    listLiveListings.mockResolvedValue(live(0));
    const res = await run();
    expect(res.status).toBe(409);
    expect((await res.json()).warning).toMatch(/nothing/i);
  });

  it("answers 503 when batch runs are not set up, reserving nothing", async () => {
    vi.stubEnv("ROUTINE_FIRE_TOKEN", "");
    expect((await run()).status).toBe(503);
    expect(files["batch/index.json"]).toBeUndefined();
  });

  it("refuses percentages that are not 0 to 100", async () => {
    expect((await run({ fiveHour: 120, weekly: 10 })).status).toBe(400);
  });
});

describe("the session's routes", () => {
  it("reads its run, saves proposals for its own listings and refuses others", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const got = await getRunRoute(req(`/api/batch/runs/${r.id}`), ctx(r.id));
    expect(((await got.json()) as { run: BatchRun }).run.skus).toEqual(r.skus);
    const ok = await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(r.skus[0], r.id)] })));
    expect(ok.status).toBe(200);
    expect(index()[r.skus[0]].status).toBe("open");
    const bad = await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal("S29-not-mine", r.id)] })));
    expect(bad.status).toBe(409);
  });

  it("finishing a run gives back every listing without a proposal", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(r.skus[0], r.id)] })));
    const res = await postRunRoute(req(`/api/batch/runs/${r.id}`, json({ status: "done" })), ctx(r.id));
    expect(res.status).toBe(200);
    const idx = index();
    expect(idx[r.skus[0]].status).toBe("open");
    expect(r.skus.slice(1).every((s) => !idx[s])).toBe(true);
  });

  it("answers 404 for an unknown run", async () => {
    expect((await getRunRoute(req("/api/batch/runs/nope"), ctx("nope"))).status).toBe(404);
  });
});

describe("GET /api/batch", () => {
  it("shows runs, open proposals and the queue, and gives up on a run after 2 hours", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(r.skus[0], r.id)] })));
    const old = { ...r, startedAt: new Date(Date.now() - 3 * 3600_000).toISOString() };
    files["batch/runs.json"] = JSON.stringify([old]);
    const body = (await (await getBatch()).json()) as {
      runs: BatchRun[];
      proposals: Proposal[];
      queue: { due: number; nextDue: string | null };
    };
    expect(body.runs[0].status).toBe("no_answer");
    expect(body.proposals.map((p) => p.sku)).toEqual([r.skus[0]]);
    expect(body.queue.due).toBe(29);
    expect(listLiveListings).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/batch/apply and dismiss", () => {
  it("applies the chosen proposals, accepting pending prices only where asked, and records the outcome", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const [a, b] = r.skus;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(a, r.id), proposal(b, r.id)] })));
    applyProposal.mockResolvedValue({ status: "applied", result: { text: "updated", price: "updated", reason: "" } });
    const res = await postApply(req("/api/batch/apply", json({ skus: [a, b], acceptPending: [b] })));
    expect(res.status).toBe(200);
    expect(applyProposal.mock.calls.map((c) => [c[1].sku, c[2]])).toEqual([
      [a, false],
      [b, true],
    ]);
    expect(index()[a].status).toBe("applied");
    expect(read<Record<string, Proposal>>("batch/proposals.json")[a].result?.text).toBe("updated");
  });

  it("dismisses proposals so later runs skip them", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(r.skus[0], r.id)] })));
    expect((await postDismiss(req("/api/batch/dismiss", json({ skus: [r.skus[0]] })))).status).toBe(200);
    expect(index()[r.skus[0]].status).toBe("dismissed");
  });

  it("never applies a proposal that is not open", async () => {
    const res = await postApply(req("/api/batch/apply", json({ skus: ["S0"], acceptPending: [] })));
    expect(((await res.json()) as { results: { status: string }[] }).results[0].status).toBe("skipped");
    expect(applyProposal).not.toHaveBeenCalled();
  });
});
