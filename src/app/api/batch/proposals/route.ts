/**
 * POST /api/batch/proposals {runId, proposals} (session): saves proposals as open. Refused (409)
 * when any of them is for a listing that run did not reserve.
 */
import { z } from "zod";
import { readProposals, writeIndex, writeProposals } from "@/lib/liveBatch/store";
import type { Proposal } from "@/lib/liveBatch/types";
import { batchStore, readState, storageError } from "../shared";

const Money = z.number().positive().max(100_000).nullable();
const ProposalIn = z.object({
  sku: z.string().min(1).max(100),
  snapshot: z.object({ title: z.string().max(200), price: z.number().nullable() }),
  title: z.string().min(1).max(200),
  addAspects: z.record(z.string().max(65), z.array(z.string().min(1).max(65)).max(30)),
  appendHtml: z.string().max(20_000),
  price: Money,
  target: Money.optional(),
  pendingPrice: Money,
  evidence: z.string().max(2_000),
  engagement: z.object({
    level: z.enum(["high", "normal", "low"]),
    sold: z.number().int().min(0),
    listed: z.number().int().min(0),
    monthsOfSupply: z.number().nullable(),
    reason: z.string().max(500),
  }),
  flags: z.array(z.string().max(300)).max(20),
});
const Body = z.object({ runId: z.string().min(1).max(100), proposals: z.array(ProposalIn).min(1).max(20) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid proposals." }, { status: 400 });
  const { runId, proposals } = parsed.data;
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const { index } = await readState(b, now);
    const notMine = proposals.filter((p) => index[p.sku]?.status !== "in_progress" || index[p.sku]?.runId !== runId);
    if (notMine.length) {
      return Response.json({ error: `Not reserved by this run: ${notMine.map((p) => p.sku).join(", ")}.` }, { status: 409 });
    }
    const all = await readProposals(b);
    const next = { ...index };
    for (const p of proposals) {
      all[p.sku] = { ...p, runId, createdAt: now.toISOString(), status: "open" } satisfies Proposal;
      next[p.sku] = { status: "open", runId, updatedAt: now.toISOString() };
    }
    await writeProposals(b, all, now);
    await writeIndex(b, next);
    return Response.json({ saved: proposals.length });
  } catch (err) {
    return storageError(err);
  }
}
