/**
 * POST /api/batch/review {skus} (phone only): moves open proposals to the Review tab, with their
 * proposed title, price and details, to edit and send later. Later runs skip them like open ones.
 */
import { z } from "zod";
import { updateIndex, updateProposals } from "@/lib/liveBatch/store";
import type { Proposal } from "@/lib/liveBatch/types";
import { batchStore, refuseKeyHeader, storageError } from "../shared";

const Body = z.object({ skus: z.array(z.string().min(1).max(100)).min(1).max(50) });

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose the proposals to send to Review." }, { status: 400 });
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    let moved: Proposal[] = [];
    await updateProposals(b, now, (all) => {
      moved = parsed.data.skus.map((sku) => all[sku]).filter((p) => p?.status === "open");
      if (!moved.length) return undefined;
      const next = { ...all };
      for (const p of moved) next[p.sku] = { ...p, status: "review" };
      return next;
    });
    if (moved.length) {
      await updateIndex(b, (index) => {
        const next = { ...index };
        for (const p of moved) next[p.sku] = { status: "review", runId: p.runId, updatedAt: now.toISOString() };
        return next;
      });
    }
    return Response.json({ moved: moved.map((p) => p.sku) });
  } catch (err) {
    return storageError(err);
  }
}
