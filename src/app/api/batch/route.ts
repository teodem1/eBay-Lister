/**
 * GET /api/batch (phone): recent runs, open proposals (and those done in the last 7 days),
 * and the queue: how many listings are due and when the next one comes due. Reads the
 * cached live SKUs, never eBay, so polling stays cheap.
 */
import { nextDue, nextSkus } from "@/lib/liveBatch/queue";
import { offerRoom } from "@/lib/liveBatch/offers";
import { readLive, readProposals, updateProposals } from "@/lib/liveBatch/store";
import { isPending, type Proposal } from "@/lib/liveBatch/types";
import { batchStore, readState, storageError } from "./shared";

export async function GET() {
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const { index, runs } = await readState(b, now);
    const [stored, live] = await Promise.all([readProposals(b), readLive(b)]);
    const proposals = Object.values(stored).some(needsBestOfferRoom)
      ? await updateProposals(b, now, (all) => (Object.values(all).some(needsBestOfferRoom) ? withBestOfferRoom(all) : undefined))
      : stored;
    return Response.json({
      runs: runs.slice(0, 10),
      proposals: Object.values(proposals).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      queue: { due: nextSkus(live, index, now, live.length).length, nextDue: nextDue(live, index, now) },
    });
  } catch (err) {
    return storageError(err);
  }
}

/**
 * Proposals waiting from before the Best Offer rule have no `target` field at all (new ones always have it,
 * null when unknown). They get it once: a lowered price is listed so a typical offer lands on the sales-based
 * price, with a flag saying so. Written back, so it happens once.
 */
const needsBestOfferRoom = (p: Proposal) => isPending(p.status) && p.target === undefined;

function withBestOfferRoom(proposals: Record<string, Proposal>): Record<string, Proposal> {
  const next: Record<string, Proposal> = {};
  for (const [sku, p] of Object.entries(proposals)) {
    if (!needsBestOfferRoom(p)) {
      next[sku] = p;
      continue;
    }
    const price = offerRoom(p.snapshot.price, p.price);
    const flags =
      price !== null && p.price !== null && price !== p.price
        ? [...p.flags, `Lowered less to leave room for Best Offer: listed at C$${price.toFixed(2)} so an 85% offer lands near C$${p.price.toFixed(2)}.`]
        : p.flags;
    next[sku] = { ...p, target: p.price, price, flags };
  }
  return next;
}
