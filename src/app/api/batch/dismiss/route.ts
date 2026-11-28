/** POST /api/batch/dismiss {skus} (phone only): marks open or Review proposals dismissed; later runs skip them for 60 days. */
import { z } from "zod";
import { updateIndex, updateProposals } from "@/lib/liveBatch/store";
import { isPending, type Proposal } from "@/lib/liveBatch/types";
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
    let done: Proposal[] = [];
    await updateProposals(b, now, (all) => {
      done = parsed.data.skus.map((sku) => all[sku]).filter((p) => p && isPending(p.status));
      if (!done.length) return undefined;
      const next = { ...all };
      for (const p of done) next[p.sku] = { ...p, status: "dismissed", doneAt: now.toISOString() };
      return next;
    });
    if (done.length) {
      await updateIndex(b, (index) => {
        const next = { ...index };
        for (const p of done) next[p.sku] = { status: "dismissed", runId: p.runId, updatedAt: now.toISOString() };
        return next;
      });
    }
    return Response.json({ dismissed: done.map((p) => p.sku) });
  } catch (err) {
    return storageError(err);
  }
}
