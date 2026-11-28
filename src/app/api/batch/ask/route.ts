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
import { readProposals, writeProposals } from "@/lib/liveBatch/store";
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
    if (!p || (p.status !== "open" && p.status !== "review")) {
      return Response.json({ error: "No open proposal for this listing." }, { status: 404 });
    }
    live = await readListing(ebay.client, sku);
    if (!live) return Response.json({ error: "This listing is not live (it sold or ended)." }, { status: 404 });
    sales = (await listingSales(b, live)).sales;
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
    const fresh = await readProposals(b);
    const cur = fresh[sku];
    if (cur) {
      // The answer re-proposes the price; the old one stays in `asked.previousPrice`. Nothing is sent to eBay.
      const repriced = asked.target !== null && asked.price !== null;
      const money = (n: number | null) => (n === null ? "no price" : `C$${n.toFixed(2)}`);
      const flag = `Price re-proposed by Ask Claude (${asked.basis === "matching" ? `${asked.matching.length} matching sales` : "estimate"}): ${money(asked.price)}, was ${money(asked.previousPrice)}.`;
      fresh[sku] = {
        ...cur,
        asked,
        ...(repriced && {
          price: asked.price,
          target: asked.target,
          flags: [...cur.flags.filter((f) => !f.startsWith("Price re-proposed by Ask Claude")), flag],
        }),
      };
    }
    await writeProposals(b, fresh, now);
  } catch (err) {
    console.error("saving the answer failed", err);
  }
  return Response.json({ asked });
}
