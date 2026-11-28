import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "../../../lib/comps/store";
import type { BatchIndex, BatchRun, Proposal } from "../../../lib/liveBatch/types";

let files: Record<string, string> = {};
let failReads = false;
let failWrites: (path: string, body: string) => boolean = () => false;
const backend: Backend = {
  read: async (p) => {
    if (failReads) throw new Error("blob down");
    return files[p] ?? null;
  },
  write: async (p, b) => {
    if (failWrites(p, b)) throw new Error("blob write failed");
    files[p] = b;
  },
};
const fireRoutine = vi.fn();
const listLiveListings = vi.fn();
const applyProposal = vi.fn();
const readListing = vi.fn();
const askAboutProposal = vi.fn();

vi.mock("@/lib/comps/store", async (orig) => ({ ...(await orig<object>()), blobBackend: () => backend }));
vi.mock("@/lib/liveBatch/fire", () => ({ fireRoutine: (...a: unknown[]) => fireRoutine(...a) }));
vi.mock("@/lib/ebay/refreshListings", async (orig) => ({
  ...(await orig<object>()),
  listLiveListings: (...a: unknown[]) => listLiveListings(...a),
  readListing: (...a: unknown[]) => readListing(...a),
}));
vi.mock("@/lib/liveBatch/ask", () => ({ askAboutProposal: (...a: unknown[]) => askAboutProposal(...a) }));
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
const { POST: postReview } = await import("./review/route");
const { POST: postEdit } = await import("./edit/route");
const { POST: postAsk } = await import("./ask/route");
const { GET: getSales } = await import("./sales/route");

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
  failWrites = () => false;
  fireRoutine.mockReset().mockResolvedValue({ sessionId: "s1", sessionUrl: "https://claude.ai/code/session_1" });
  listLiveListings.mockReset().mockResolvedValue(live(30));
  applyProposal.mockReset();
  readListing.mockReset();
  askAboutProposal.mockReset();
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

  it("reserves nothing when the run record cannot be saved", async () => {
    failWrites = (p) => p === "batch/runs.json";
    expect((await run()).status).toBe(502);
    expect(files["batch/index.json"]).toBeUndefined();
    expect(fireRoutine).not.toHaveBeenCalled();
  });

  it("keeps proposals a running batch saved while this run was listing eBay", async () => {
    const first = ((await (await run()).json()) as { run: BatchRun }).run;
    listLiveListings.mockImplementation(async () => {
      await postProposals(req("/api/batch/proposals", json({ runId: first.id, proposals: [proposal(first.skus[0], first.id)] })));
      return live(30);
    });
    await run();
    expect(index()[first.skus[0]].status).toBe("open");
  });

  it("keeps the reservation when the run started but its record could not be updated", async () => {
    let saves = 0;
    failWrites = (p) => p === "batch/runs.json" && ++saves === 2;
    const res = await run();
    expect(res.status).toBe(200);
    expect(Object.values(index()).filter((e) => e.status === "in_progress")).toHaveLength(20);
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

  it("keeps proposals a session saved while another was being applied", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const [a, b] = r.skus;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(a, r.id)] })));
    applyProposal.mockImplementation(async () => {
      await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(b, r.id)] })));
      return { status: "applied", result: { text: "updated", price: "updated", reason: "" } };
    });
    await postApply(req("/api/batch/apply", json({ skus: [a], acceptPending: [] })));
    expect(read<Record<string, Proposal>>("batch/proposals.json")[b]?.status).toBe("open");
    expect(index()[b].status).toBe("open");
    expect(index()[a].status).toBe("applied");
  });

  it("refuses the key header itself on the phone-only routes", async () => {
    const withKey = (body: unknown) => ({ ...json(body), headers: { "x-elister-key": "anything" } });
    for (const res of [
      await postApply(req("/api/batch/apply", withKey({ skus: ["S0"], acceptPending: [] }))),
      await postDismiss(req("/api/batch/dismiss", withKey({ skus: ["S0"] }))),
      await postRun(req("/api/batch/run", withKey({ fiveHour: 10, weekly: 10 }))),
      await postReview(req("/api/batch/review", withKey({ skus: ["S0"] }))),
      await postEdit(req("/api/batch/edit", withKey({ sku: "S0", title: "T", price: 10 }))),
      await postAsk(req("/api/batch/ask", withKey({ sku: "S0", note: "LED spine" }))),
    ]) expect(res.status).toBe(401);
    expect(applyProposal).not.toHaveBeenCalled();
    expect(fireRoutine).not.toHaveBeenCalled();
  });

  it("sends proposals to Review, edits them there, and applies them from there", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const [a] = r.skus;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [{ ...proposal(a, r.id), target: 9.5 }] })));
    expect((await postReview(req("/api/batch/review", json({ skus: [a] })))).status).toBe(200);
    expect(index()[a].status).toBe("review");
    const edited = await postEdit(req("/api/batch/edit", json({ sku: a, title: "T edited", price: 12.5 })));
    expect(edited.status).toBe(200);
    const saved = read<Record<string, Proposal>>("batch/proposals.json")[a];
    expect([saved.status, saved.title, saved.price, saved.target]).toEqual(["review", "T edited", 12.5, 9.5]);
    applyProposal.mockResolvedValue({ status: "applied", result: { text: "updated", price: "updated", reason: "" } });
    await postApply(req("/api/batch/apply", json({ skus: [a], acceptPending: [] })));
    expect(applyProposal.mock.calls[0][1]).toMatchObject({ title: "T edited", price: 12.5 });
    expect(index()[a].status).toBe("applied");
  });

  it("refuses an edit that is too long, not positive, or for a proposal already done", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(r.skus[0], r.id)] })));
    expect((await postEdit(req("/api/batch/edit", json({ sku: r.skus[0], title: "x".repeat(81), price: 10 })))).status).toBe(400);
    expect((await postEdit(req("/api/batch/edit", json({ sku: r.skus[0], title: "T", price: 0 })))).status).toBe(400);
    expect((await postEdit(req("/api/batch/edit", json({ sku: "S0", title: "T", price: 10 })))).status).toBe(404);
  });

  it("lowers a waiting proposal made before the Best Offer rule once, keeping its target", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const [a, b] = r.skus;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(a, r.id), proposal(b, r.id)] })));
    const all = read<Record<string, Proposal>>("batch/proposals.json");
    for (const sku of [a, b]) delete (all[sku] as { target?: number | null }).target;
    all[a] = { ...all[a], snapshot: { title: "T", price: 28.99 }, price: 11.4 };
    all[b] = { ...all[b], snapshot: { title: "T", price: 10 }, price: 12 };
    files["batch/proposals.json"] = JSON.stringify(all);
    const body = (await (await getBatch()).json()) as { proposals: Proposal[] };
    const got = Object.fromEntries(body.proposals.map((x) => [x.sku, x]));
    expect([got[a].price, got[a].target]).toEqual([13.41, 11.4]);
    expect(got[a].flags.join(" ")).toMatch(/offer/i);
    expect([got[b].price, got[b].target]).toEqual([12, 12]);
    await getBatch();
    expect(read<Record<string, Proposal>>("batch/proposals.json")[a].price).toBe(13.41);
  });

  it("asks Claude with the stored sales of that listing and keeps the answer on the proposal", async () => {
    const r = ((await (await run()).json()) as { run: BatchRun }).run;
    const [a] = r.skus;
    await postProposals(req("/api/batch/proposals", json({ runId: r.id, proposals: [proposal(a, r.id)] })));
    await postReview(req("/api/batch/review", json({ skus: [a] })));
    readListing.mockResolvedValue({ sku: a, title: "T", price: 10, barcode: "075678154323", query: "Genesis Wind & Wuthering", aspects: {}, descriptionHtml: "", imageUrls: [] });
    const sold = (id: string, value: number) => ({ itemId: id, title: "Genesis CD", price: { value, currency: "CAD" }, shippingCost: null, itemLocation: { country: null, postalCode: null }, shippingDestination: null, condition: null, soldDate: null, quantitySold: 1, url: null });
    files["comps/upc/075678154323.json"] = JSON.stringify({
      version: 1, savedAt: "2026-11-28T00:00:00.000Z", partial: false, barcode: "075678154323",
      queries: [{ by: "barcode", items: [sold("x", 19), sold("y", 55)] }],
      filtered: { cdOnly: ["x", "y"], sameGrade: ["y"], detail: {} },
    });
    askAboutProposal.mockResolvedValue({ note: "LED spine", answer: "ok", matching: ["y"], target: 55, price: 55, title: null, at: "2026-11-28T00:00:00.000Z" });
    const res = await postAsk(req("/api/batch/ask", json({ sku: a, note: "LED spine" })));
    expect(res.status).toBe(200);
    const [, p, note, sales] = askAboutProposal.mock.calls[0];
    expect([p.sku, note, sales.map((x: { itemId: string }) => x.itemId)]).toEqual([a, "LED spine", ["y"]]);
    expect((read<Record<string, Proposal>>("batch/proposals.json")[a] as Proposal & { asked?: { answer: string } }).asked?.answer).toBe("ok");
    expect(applyProposal).not.toHaveBeenCalled();
  });

  it("refuses to ask about a proposal that is not open or in Review, or an empty note", async () => {
    expect((await postAsk(req("/api/batch/ask", json({ sku: "S0", note: "LED" })))).status).toBe(404);
    expect((await postAsk(req("/api/batch/ask", json({ sku: "S0", note: "" })))).status).toBe(400);
    expect(askAboutProposal).not.toHaveBeenCalled();
  });

  it("shows a listing's stored same-grade sales, with no lookup", async () => {
    readListing.mockResolvedValue({ sku: "S0", title: "T", price: 10, barcode: "075678154323", query: "Genesis", aspects: {}, descriptionHtml: "", imageUrls: [] });
    const sold = (id: string) => ({ itemId: id, title: "Genesis CD", price: { value: 10, currency: "CAD" }, shippingCost: null, itemLocation: { country: null, postalCode: null }, shippingDestination: null, condition: null, soldDate: "2026-10-01", quantitySold: 1, url: null });
    files["comps/upc/075678154323.json"] = JSON.stringify({
      version: 1, savedAt: "2026-11-20T00:00:00.000Z", partial: true, barcode: "075678154323",
      queries: [{ by: "barcode", items: [sold("x"), sold("y")] }],
      filtered: { cdOnly: ["x", "y"], sameGrade: ["x"], detail: {} },
    });
    const body = await (await getSales(req("/api/batch/sales?sku=S0"))).json();
    expect(body).toMatchObject({ savedAt: "2026-11-20T00:00:00.000Z", partial: true });
    expect(body.sales.map((x: { itemId: string }) => x.itemId)).toEqual(["x"]);
    expect(fireRoutine).not.toHaveBeenCalled();
  });

  it("answers an empty list when nothing is stored, and 404 when the listing is gone", async () => {
    readListing.mockResolvedValue({ sku: "S0", title: "T", price: 10, query: "Nothing Stored", aspects: {}, descriptionHtml: "", imageUrls: [] });
    expect((await (await getSales(req("/api/batch/sales?sku=S0"))).json()).sales).toEqual([]);
    readListing.mockResolvedValue(null);
    expect((await getSales(req("/api/batch/sales?sku=S0"))).status).toBe(404);
  });

  it("never applies a proposal that is not open", async () => {
    const res = await postApply(req("/api/batch/apply", json({ skus: ["S0"], acceptPending: [] })));
    expect(((await res.json()) as { results: { status: string }[] }).results[0].status).toBe("skipped");
    expect(applyProposal).not.toHaveBeenCalled();
  });
});
