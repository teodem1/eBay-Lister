/**
 * Batch records in the private Blob store: one index file, one file per proposal and
 * one file of recent runs. Read by key, never listed. Storage that cannot be read rejects:
 * a caller stops rather than treating it as "nothing stored".
 */
import type { Backend } from "../comps/store";
import type { BatchIndex, BatchRun, Proposal } from "./types";

const INDEX = "batch/index.json";
const RUNS = "batch/runs.json";
const KEEP_RUNS = 50;
const proposalPath = (sku: string) => `batch/proposals/${encodeURIComponent(sku)}.json`;

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

export async function readProposal(b: Backend, sku: string): Promise<Proposal | null> {
  const path = proposalPath(sku);
  const text = await b.read(path);
  return text === null ? null : parse<Proposal>(path, text, (v) => isObject(v) && typeof (v as Proposal).sku === "string");
}

export async function saveProposal(b: Backend, p: Proposal): Promise<void> {
  await b.write(proposalPath(p.sku), JSON.stringify(p));
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
