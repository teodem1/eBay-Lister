/** Shared by the batch routes: the Blob store or a 503, and the batch state read once per request. */
import { KEY_HEADER } from "@/lib/auth/access";
import { blobBackend, type Backend } from "@/lib/comps/store";
import { expireRuns } from "@/lib/liveBatch/queue";
import { readIndex, readRuns, saveRun, updateIndex } from "@/lib/liveBatch/store";
import type { BatchIndex, BatchRun } from "@/lib/liveBatch/types";

export function batchStore(): Backend | Response {
  return blobBackend() ?? Response.json({ error: "Batches are not set up (no Blob store)." }, { status: 503 });
}

export function storageError(err: unknown): Response {
  console.error("batch storage failed", err);
  return Response.json({ error: "Batch records could not be read or written." }, { status: 502 });
}

/** The index and runs, with runs over 2 hours given up on (written back when that changed anything). */
export async function readState(b: Backend, now: Date): Promise<{ index: BatchIndex; runs: BatchRun[] }> {
  const [index, runs] = await Promise.all([readIndex(b), readRuns(b)]);
  const out = expireRuns(runs, index, now);
  const expired = out.runs.filter((r, i) => r !== runs[i]);
  // Released on the index as stored now, so a change written meanwhile is kept.
  const stored = out.index === index ? index : await updateIndex(b, (cur) => expireRuns(runs, cur, now).index);
  for (const r of expired) await saveRun(b, r);
  return { runs: out.runs, index: stored };
}

/** Phone-only routes refuse any request carrying the key header (a cloud session), whatever path reached them. */
export function refuseKeyHeader(request: Request): Response | null {
  return request.headers.has(KEY_HEADER)
    ? Response.json({ error: "Only the phone can start, send or dismiss batches." }, { status: 401 })
    : null;
}
