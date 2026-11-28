/** POST /api/batch/dismiss {skus} (phone only): marks open proposals dismissed; later runs skip them for 60 days. */
import { z } from "zod";
import { readIndex, readProposals, writeIndex, writeProposals } from "@/lib/liveBatch/store";
import { batchStore, storageError, refuseKeyHeader } from "../shared";

const Body = z.object({ skus: z.array(z.string().min(1).max(100)).min(1).max(50) });

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose the proposals to dismiss." }, { status: 400 });
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const [proposals, index] = await Promise.all([readProposals(b), readIndex(b)]);
    const done: string[] = [];
    for (const sku of parsed.data.skus) {
      if (proposals[sku]?.status !== "open") continue;
      proposals[sku] = { ...proposals[sku], status: "dismissed", doneAt: now.toISOString() };
      index[sku] = { status: "dismissed", runId: proposals[sku].runId, updatedAt: now.toISOString() };
      done.push(sku);
    }
    await writeProposals(b, proposals, now);
    await writeIndex(b, index);
    return Response.json({ dismissed: done });
  } catch (err) {
    return storageError(err);
  }
}
