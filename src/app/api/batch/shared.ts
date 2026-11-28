/** Shared by the batch routes: the Blob store or a 503, and the batch state read once per request. */
import { blobBackend, type Backend } from "@/lib/comps/store";
import { expireRuns } from "@/lib/liveBatch/queue";
import { readIndex, readRuns, saveRun, writeIndex } from "@/lib/liveBatch/store";
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
  if (expired.length) {
    await writeIndex(b, out.index);
    for (const r of expired) await saveRun(b, r);
  }
  return out;
}
