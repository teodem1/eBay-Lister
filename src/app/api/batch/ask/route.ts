/**
 * POST /api/batch/ask {sku, note} (phone only): "Ask Claude" on a proposal that is open or in Review.
 * The seller's note and the listing's stored same-grade sales go to a small model (app's Claude API key);
 * the answer is saved on the proposal and its price re-proposed (old price kept in the answer). No sold lookup,
 * nothing sent to eBay: the seller still sends it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readListing } from "@/lib/ebay/refreshListings";
import { claudeErrorMessage, claudeErrorStatus } from "@/lib/claude/errors";
import { askAboutProposal } from "@/lib/liveBatch/ask";
import { listingSales } from "@/lib/liveBatch/sales";
import { readProposals, updateProposals } from "@/lib/liveBatch/store";
import { isPending } from "@/lib/liveBatch/types";
import { sellClient } from "@/app/api/listing/refresh/shared";
import { batchStore, refuseKeyHeader, storageError } from "../shared";

const Body = z.object({ sku: z.string().min(1).max(100), note: z.string().trim().min(1).max(600) });

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write what you know about your copy (up to 600 characters)." }, { status: 400 });
  const { sku, note } = parsed.data;
  const b = batchStore();
  if (b instanceof Response) return b;
  const ebay = sellClient();
  if (ebay instanceof Response) return ebay;

  let p, sales;
  let live;
  try {
    p = (await readProposals(b))[sku];
    if (!p || !isPending(p.status)) {
      return Response.json({ error: "No open proposal for this listing." }, { status: 404 });
    }
    live = await readListing(ebay.client, sku);
    if (!live) return Response.json({ error: "This listing is not live (it sold or ended)." }, { status: 404 });
    sales = (await listingSales(b, live, live.sellerCondition?.condition)).sales;
  } catch (err) {
    return storageError(err);
  }

  let asked;
  try {
    asked = await askAboutProposal(live, p, note, sales);
  } catch (err) {
    const message = claudeErrorMessage(err);
    if (message) return Response.json({ error: message }, { status: err instanceof Anthropic.APIError ? claudeErrorStatus(err) : 502 });
    console.error("asking Claude failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Claude could not answer." }, { status: 502 });
  }

  try {
    const now = new Date();
    const answer = asked;
    await updateProposals(b, now, (fresh) => {
      const cur = fresh[sku];
      if (!cur) return undefined;
      // The answer re-proposes the price; the batch's own price stays in `asked.previousPrice`. Nothing is sent
      // to eBay. It replaces the earlier price notes and the one-sale pending price, which Apply would else prefer.
      const repriced = answer.target !== null && answer.price !== null;
      const money = (n: number | null) => (n === null ? "no price" : `C$${n.toFixed(2)}`);
      const flag = `Price re-proposed by Ask Claude (${answer.basis === "matching" ? `${answer.matching.length} matching sales` : "estimate"}): ${money(answer.price)}, was ${money(answer.previousPrice)}.`;
      const stale = (f: string) => f.startsWith("Price re-proposed by Ask Claude") || f.startsWith("Lowered less to leave room for Best Offer");
      return {
        ...fresh,
        [sku]: {
          ...cur,
          asked: answer,
          ...(repriced && { price: answer.price, target: answer.target, pendingPrice: null, flags: [...cur.flags.filter((f) => !stale(f)), flag] }),
        },
      };
    });
  } catch (err) {
    console.error("saving the answer failed", err);
  }
  return Response.json({ asked });
}
