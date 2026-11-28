/**
 * GET /api/batch (phone): recent runs, open proposals (and those done in the last 7 days),
 * and the queue: how many listings are due and when the next one comes due. Reads the
 * cached live SKUs, never eBay, so polling stays cheap.
 */
import { nextDue, nextSkus } from "@/lib/liveBatch/queue";
import { readLive, readProposals } from "@/lib/liveBatch/store";
import { batchStore, readState, storageError } from "./shared";

export async function GET() {
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const { index, runs } = await readState(b, now);
    const [proposals, live] = await Promise.all([readProposals(b), readLive(b)]);
    return Response.json({
      runs: runs.slice(0, 10),
      proposals: Object.values(proposals).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      queue: { due: nextSkus(live, index, now, live.length).length, nextDue: nextDue(live, index, now) },
    });
  } catch (err) {
    return storageError(err);
  }
}
