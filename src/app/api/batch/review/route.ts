/**
 * POST /api/batch/review {skus} (phone only): moves open proposals to the Review tab, with their
 * proposed title, price and details, to edit and send later. Later runs skip them like open ones.
 */
import { z } from "zod";
import { readIndex, readProposals, writeIndex, writeProposals } from "@/lib/liveBatch/store";
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
    const [proposals, index] = await Promise.all([readProposals(b), readIndex(b)]);
    const moved: string[] = [];
    for (const sku of parsed.data.skus) {
      if (proposals[sku]?.status !== "open") continue;
      proposals[sku] = { ...proposals[sku], status: "review" };
      index[sku] = { status: "review", runId: proposals[sku].runId, updatedAt: now.toISOString() };
      moved.push(sku);
    }
    await writeProposals(b, proposals, now);
    await writeIndex(b, index);
    return Response.json({ moved });
  } catch (err) {
    return storageError(err);
  }
}
