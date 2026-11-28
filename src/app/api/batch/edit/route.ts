/**
 * POST /api/batch/edit {sku, title, price} (phone only): the seller's own title and price for a proposal
 * that is open or in Review. Nothing is sent to eBay; Apply still re-reads and checks the listing.
 */
import { z } from "zod";
import { TITLE_MAX } from "@/lib/listing/limits";
import { updateProposals } from "@/lib/liveBatch/store";
import { isPending, type Proposal } from "@/lib/liveBatch/types";
import { batchStore, refuseKeyHeader, storageError } from "../shared";

const Body = z.object({
  sku: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(TITLE_MAX),
  price: z.number().positive().max(100_000),
});

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `The title needs 1 to ${TITLE_MAX} characters and the price must be above 0.` }, { status: 400 });
  }
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const { sku, title } = parsed.data;
    const price = Math.round(parsed.data.price * 100) / 100;
    let edited: Proposal | undefined;
    await updateProposals(b, now, (all) => {
      const p = all[sku];
      if (!p || !isPending(p.status)) return (edited = undefined);
      edited = { ...p, title, price };
      return { ...all, [sku]: edited };
    });
    if (!edited) return Response.json({ error: "No open proposal for this listing." }, { status: 404 });
    return Response.json({ proposal: edited });
  } catch (err) {
    return storageError(err);
  }
}
