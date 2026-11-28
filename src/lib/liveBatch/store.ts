/**
 * Batch records in the private Blob store: the index, the proposals, recent runs and the
 * cached live SKUs, one file each. Read by key, never listed. Storage that cannot be read rejects:
 * a caller stops rather than treating it as "nothing stored".
 */
import type { Backend } from "../comps/store";
import type { BatchIndex, BatchRun, Proposal } from "./types";

const INDEX = "batch/index.json";
const RUNS = "batch/runs.json";
const PROPOSALS = "batch/proposals.json";
const LIVE = "batch/live.json";
const KEEP_RUNS = 50;
const KEEP_DONE_DAYS = 7;

function parse<T>(path: string, text: string, ok: (v: unknown) => boolean): T {
  const v = JSON.parse(text) as unknown;
  if (!ok(v)) throw new Error(`${path} is not readable.`);
  return v as T;
}

const isObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export async function readIndex(b: Backend): Promise<BatchIndex> {
  const text = await b.read(INDEX);
  return text === null ? {} : parse<BatchIndex>(INDEX, text, isObject);
}

export async function writeIndex(b: Backend, index: BatchIndex): Promise<void> {
  await b.write(INDEX, JSON.stringify(index));
}

/** Open proposals and those done in the last 7 days, by SKU (one file, one read per poll). */
export async function readProposals(b: Backend): Promise<Record<string, Proposal>> {
  const text = await b.read(PROPOSALS);
  return text === null ? {} : parse<Record<string, Proposal>>(PROPOSALS, text, isObject);
}

/** Writes the proposals, dropping those applied, dismissed, failed or stale more than 7 days ago. */
export async function writeProposals(b: Backend, proposals: Record<string, Proposal>, now: Date): Promise<void> {
  const cutoff = now.getTime() - KEEP_DONE_DAYS * 86_400_000;
  const kept = Object.fromEntries(
    Object.entries(proposals).filter(
      ([, p]) => p.status === "open" || p.status === "in_progress" || new Date(p.doneAt ?? p.createdAt).getTime() >= cutoff,
    ),
  );
  await b.write(PROPOSALS, JSON.stringify(kept));
}

/** The live SKUs as eBay listed them when the last run started (so polling never calls eBay). */
export async function readLive(b: Backend): Promise<string[]> {
  const text = await b.read(LIVE);
  return text === null ? [] : parse<string[]>(LIVE, text, Array.isArray);
}

export async function writeLive(b: Backend, skus: string[]): Promise<void> {
  await b.write(LIVE, JSON.stringify(skus));
}

/** Recent runs, newest first. */
export async function readRuns(b: Backend): Promise<BatchRun[]> {
  const text = await b.read(RUNS);
  return text === null ? [] : parse<BatchRun[]>(RUNS, text, Array.isArray);
}

export async function readRun(b: Backend, id: string): Promise<BatchRun | null> {
  return (await readRuns(b)).find((r) => r.id === id) ?? null;
}

/** Adds the run, or replaces the one with its id; keeps the newest 50. */
export async function saveRun(b: Backend, run: BatchRun): Promise<void> {
  const runs = await readRuns(b);
  const at = runs.findIndex((r) => r.id === run.id);
  const next = at >= 0 ? runs.map((r, i) => (i === at ? run : r)) : [run, ...runs];
  await b.write(RUNS, JSON.stringify(next.slice(0, KEEP_RUNS)));
}
