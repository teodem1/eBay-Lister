/**
 * Batch records in the private Blob store: the index, the proposals, recent runs and the
 * cached live SKUs, one file each. Read by key, never listed. Storage that cannot be read rejects:
 * a caller stops rather than treating it as "nothing stored".
 *
 * Two runs, the phone and its polling can change the same file at once, so every change goes through
 * `update*`: read with the file's version, change, write only if the file is still that version, else redo.
 */
import { WriteConflict, type Backend } from "../comps/store";
import { isPending, type BatchIndex, type BatchRun, type Proposal } from "./types";

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
const TRIES = 5;

/**
 * Reads the file, applies `change` and writes the result only if nobody wrote the file in between
 * (redone up to 5 times). `change` returns undefined to leave the file as it is; it may run more than
 * once, so it must only compute. Returns what is stored afterwards.
 */
async function update<T>(
  b: Backend,
  path: string,
  read: (text: string | null) => T,
  change: (current: T) => T | undefined,
  serialize: (value: T) => string = (v) => JSON.stringify(v),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const got = b.readTagged ? await b.readTagged(path) : await b.read(path).then((text) => (text === null ? null : { text, etag: undefined }));
    const current = read(got?.text ?? null);
    const next = change(current);
    if (next === undefined) return current;
    try {
      await b.write(path, serialize(next), got?.etag ? { ifMatch: got.etag } : undefined);
      return next;
    } catch (err) {
      if (!(err instanceof WriteConflict) || attempt >= TRIES) throw err;
    }
  }
}

const parseIndex = (text: string | null): BatchIndex => (text === null ? {} : parse<BatchIndex>(INDEX, text, isObject));
const parseProposals = (text: string | null): Record<string, Proposal> =>
  text === null ? {} : parse<Record<string, Proposal>>(PROPOSALS, text, isObject);
const parseRuns = (text: string | null): BatchRun[] => (text === null ? [] : parse<BatchRun[]>(RUNS, text, Array.isArray));

export async function readIndex(b: Backend): Promise<BatchIndex> {
  return parseIndex(await b.read(INDEX));
}

/** Changes the index safely (see `update`); `change` returns undefined for no change. */
export function updateIndex(b: Backend, change: (index: BatchIndex) => BatchIndex | undefined): Promise<BatchIndex> {
  return update(b, INDEX, parseIndex, change);
}

export async function writeIndex(b: Backend, index: BatchIndex): Promise<void> {
  await b.write(INDEX, JSON.stringify(index));
}

/** Open proposals and those done in the last 7 days, by SKU (one file, one read per poll). */
export async function readProposals(b: Backend): Promise<Record<string, Proposal>> {
  return parseProposals(await b.read(PROPOSALS));
}

/** The proposals without those applied, dismissed, failed or stale more than 7 days ago. */
function pruned(proposals: Record<string, Proposal>, now: Date): Record<string, Proposal> {
  const cutoff = now.getTime() - KEEP_DONE_DAYS * 86_400_000;
  return Object.fromEntries(
    Object.entries(proposals).filter(
      ([, p]) => isPending(p.status) || p.status === "in_progress" || new Date(p.doneAt ?? p.createdAt).getTime() >= cutoff,
    ),
  );
}

/** Writes the proposals as given (pruned). Prefer `updateProposals`, which never loses another writer's change. */
export async function writeProposals(b: Backend, proposals: Record<string, Proposal>, now: Date): Promise<void> {
  await b.write(PROPOSALS, JSON.stringify(pruned(proposals, now)));
}

/** Changes the proposals safely (see `update`), pruning old ones; `change` returns undefined for no change. */
export function updateProposals(
  b: Backend,
  now: Date,
  change: (proposals: Record<string, Proposal>) => Record<string, Proposal> | undefined,
): Promise<Record<string, Proposal>> {
  return update(b, PROPOSALS, parseProposals, change, (v) => JSON.stringify(pruned(v, now)));
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
  return parseRuns(await b.read(RUNS));
}

export async function readRun(b: Backend, id: string): Promise<BatchRun | null> {
  return (await readRuns(b)).find((r) => r.id === id) ?? null;
}

/** Adds the run, or replaces the one with its id; keeps the newest 50. */
export async function saveRun(b: Backend, run: BatchRun): Promise<void> {
  await update(b, RUNS, parseRuns, (runs) => {
    const at = runs.findIndex((r) => r.id === run.id);
    const next = at >= 0 ? runs.map((r, i) => (i === at ? run : r)) : [run, ...runs];
    return next.slice(0, KEEP_RUNS);
  });
}
