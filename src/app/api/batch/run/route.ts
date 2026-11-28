/**
 * POST /api/batch/run {fiveHour, weekly} (phone only): starts a batch. Counts the CDs of runs
 * still going, warns (409) when another batch would reach the 80% stop or nothing is due,
 * otherwise reserves the next listings and fires the seller's Claude Code task.
 */
import { z } from "zod";
import { listLiveListings } from "@/lib/ebay/refreshListings";
import { sellClient } from "@/app/api/listing/refresh/shared";
import { fireRoutine } from "@/lib/liveBatch/fire";
import { estimateFits, nextDue, nextSkus, release, reserve } from "@/lib/liveBatch/queue";
import { saveRun, writeIndex, writeLive } from "@/lib/liveBatch/store";
import type { BatchRun } from "@/lib/liveBatch/types";
import { batchStore, readState, storageError } from "../shared";

const SIZE = 20;
const Body = z.object({ fiveHour: z.number().min(0).max(100), weekly: z.number().min(0).max(100) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give both usage percentages, each from 0 to 100." }, { status: 400 });
  const { fiveHour, weekly } = parsed.data;
  if (!process.env.ROUTINE_FIRE_URL || !process.env.ROUTINE_FIRE_TOKEN) {
    return Response.json({ error: "Batch runs are not set up (ROUTINE_FIRE_URL, ROUTINE_FIRE_TOKEN)." }, { status: 503 });
  }
  const b = batchStore();
  if (b instanceof Response) return b;
  const ebay = sellClient();
  if (ebay instanceof Response) return ebay;
  const now = new Date();

  let state;
  try {
    state = await readState(b, now);
  } catch (err) {
    return storageError(err);
  }
  const running = state.runs
    .filter((r) => r.status === "started")
    .reduce((n, r) => n + r.skus.filter((s) => state.index[s]?.status === "in_progress" && state.index[s]?.runId === r.id).length, 0);
  const fit = estimateFits(fiveHour, weekly, running, SIZE);
  if (fit.batch === 0) return Response.json({ warning: fit.reason }, { status: 409 });

  const live: string[] = [];
  try {
    for (let offset: number | undefined = 0; offset !== undefined; ) {
      const page = await listLiveListings(ebay.client, offset);
      live.push(...page.listings.map((l) => l.sku));
      offset = page.nextOffset;
    }
  } catch (err) {
    console.error("listing live listings failed", err);
    return Response.json({ error: "eBay live listings could not be read." }, { status: 502 });
  }
  const skus = nextSkus(live, state.index, now, fit.batch);
  if (!skus.length) {
    const due = nextDue(live, state.index, now);
    return Response.json(
      { warning: due ? `Nothing is due. The next listing comes due on ${due.slice(0, 10)}.` : "Nothing is due: every live listing has a proposal.", nextDue: due },
      { status: 409 },
    );
  }

  const run: BatchRun = { id: crypto.randomUUID(), startedAt: now.toISOString(), fiveHour, weekly, skus, status: "started" };
  const reserved = reserve(state.index, skus, run.id, now);
  try {
    await writeIndex(b, reserved);
    await saveRun(b, run);
    await writeLive(b, live);
  } catch (err) {
    return storageError(err);
  }
  try {
    const fired = await fireRoutine(process.env, JSON.stringify({ runId: run.id, fiveHour, weekly }));
    const started = { ...run, sessionUrl: fired.sessionUrl };
    await saveRun(b, started);
    return Response.json({ run: started, note: fit.batch < SIZE ? fit.reason : undefined });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "The batch could not start.";
    try {
      await writeIndex(b, release(reserved, skus));
      await saveRun(b, { ...run, status: "failed", reason, finishedAt: new Date().toISOString() });
    } catch (e) {
      console.error("releasing a failed run failed", e);
    }
    return Response.json({ error: reason }, { status: 502 });
  }
}
