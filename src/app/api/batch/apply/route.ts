/**
 * POST /api/batch/apply {skus, acceptPending} (phone only; src/proxy.ts refuses the key header):
 * applies the chosen open proposals one by one and records each outcome.
 */
import { z } from "zod";
import { errorResponse, sellClient } from "@/app/api/listing/refresh/shared";
import { applyProposal } from "@/lib/liveBatch/apply";
import { readIndex, readProposals, writeIndex, writeProposals } from "@/lib/liveBatch/store";
import { batchStore, storageError, refuseKeyHeader } from "../shared";

const Body = z.object({ skus: z.array(z.string().min(1).max(100)).min(1).max(50), acceptPending: z.array(z.string().max(100)).max(50) });

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose the proposals to send." }, { status: 400 });
  const b = batchStore();
  if (b instanceof Response) return b;
  const ebay = sellClient();
  if (ebay instanceof Response) return ebay;
  const results: { sku: string; status: string; result?: { text: string; price: string; reason: string } }[] = [];
  try {
    for (const sku of parsed.data.skus) {
      const proposals = await readProposals(b);
      const p = proposals[sku];
      if (!p || (p.status !== "open" && p.status !== "review")) {
        results.push({ sku, status: "skipped", result: { text: "skipped", price: "skipped", reason: "No open proposal for this listing." } });
        continue;
      }
      let outcome;
      try {
        outcome = await applyProposal(ebay.client, p, parsed.data.acceptPending.includes(sku), {
          bestOfferMinPercent: ebay.config.bestOfferMinPercent,
          currency: ebay.config.currency,
        });
      } catch (err) {
        return errorResponse(err);
      }
      // Read again after the eBay calls, so proposals a session saved meanwhile are kept.
      const now = new Date();
      const fresh = await readProposals(b);
      fresh[sku] = { ...p, status: outcome.status, result: outcome.result, doneAt: now.toISOString() };
      await writeProposals(b, fresh, now);
      const index = await readIndex(b);
      await writeIndex(b, { ...index, [sku]: { status: outcome.status, runId: p.runId, updatedAt: now.toISOString() } });
      results.push({ sku, status: outcome.status, result: outcome.result });
    }
    return Response.json({ results });
  } catch (err) {
    return storageError(err);
  }
}
