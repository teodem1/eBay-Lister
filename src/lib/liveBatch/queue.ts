/**
 * The batch queue: which live listings the next run takes, reservations so two runs never
 * take the same listing, the usage estimate for runs still going, and runs that never answered.
 * Pure: the routes read and write the index around these.
 */
import type { BatchIndex, BatchRun, IndexEntry } from "./types";

const DAY = 86_400_000;
/** A listing still live this long after its last proposal is proposed again (seller, 2026-11-28). */
export const REVISIT_DAYS = 60;
/** A run that has not finished this long after starting is given up on. */
export const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Usage stop and cost per CD, as the skill's gate.py (from the 5-CD trial). */
export const USAGE_STOP = 80;
export const FIVE_HOUR_PER_CD = 1;
export const WEEKLY_PER_CD = 0.2;

const time = (iso: string) => new Date(iso).getTime();
const revisitDone = (e: IndexEntry, now: Date) =>
  (e.status === "applied" || e.status === "dismissed" || e.status === "open") && now.getTime() - time(e.updatedAt) >= REVISIT_DAYS * DAY;
const oldestFirst = (index: BatchIndex) => (a: string, b: string) => time(index[a].updatedAt) - time(index[b].updatedAt);

/**
 * The next listings to propose: never proposed (newest first: the reverse of eBay's inventory
 * order, which gives no listing date), then failed or stale ones, then listings 60 or more days
 * after their last proposal, oldest first. Only live listings; never one reserved or recently done.
 */
export function nextSkus(live: string[], index: BatchIndex, now: Date, size: number): string[] {
  const fresh = [...live].reverse().filter((s) => !index[s]);
  const retry = live.filter((s) => index[s]?.status === "failed" || index[s]?.status === "stale").sort(oldestFirst(index));
  const revisit = live.filter((s) => index[s] && revisitDone(index[s], now)).sort(oldestFirst(index));
  return [...fresh, ...retry, ...revisit].slice(0, size);
}

/** When the next listing comes due (ISO), or null when one is due now or none ever will be. */
export function nextDue(live: string[], index: BatchIndex, now: Date): string | null {
  if (nextSkus(live, index, now, 1).length) return null;
  const waiting = live
    .map((s) => index[s])
    .filter((e) => e && (e.status === "applied" || e.status === "dismissed" || e.status === "open"))
    .map((e) => time(e.updatedAt) + REVISIT_DAYS * DAY);
  return waiting.length ? new Date(Math.min(...waiting)).toISOString() : null;
}

function fits(used: number, perCd: number, wanted: number): number {
  let n = Math.min(wanted, Math.floor((USAGE_STOP - used) / perCd) + 1);
  while (n > 0 && used + n * perCd >= USAGE_STOP - 1e-9) n--;
  return Math.max(n, 0);
}

/** How many CDs a new run may take before either limit would reach the stop, counting the CDs runs still hold. */
export function estimateFits(fiveHour: number, weekly: number, runningCds: number, size: number): { batch: number; reason: string } {
  const five = fiveHour + runningCds * FIVE_HOUR_PER_CD;
  const week = weekly + runningCds * WEEKLY_PER_CD;
  const batch = Math.min(fits(five, FIVE_HOUR_PER_CD, size), fits(week, WEEKLY_PER_CD, size));
  const running = runningCds ? `, plus about ${Math.round(runningCds * FIVE_HOUR_PER_CD)} points for the ${runningCds} CDs still running` : "";
  const usage = `Usage ${fiveHour}% (five-hour) and ${weekly}% (weekly)${running}`;
  const reason =
    batch === 0
      ? `${usage}: another batch would reach the ${USAGE_STOP}% stop. Wait for usage to go down.`
      : batch < size
        ? `${usage}: ${batch} CDs fit before the ${USAGE_STOP}% stop.`
        : `${usage}: a batch of ${size} fits under the ${USAGE_STOP}% stop.`;
  return { batch, reason };
}

export function reserve(index: BatchIndex, skus: string[], runId: string, now: Date): BatchIndex {
  const next = { ...index };
  for (const s of skus) {
    const was = index[s];
    next[s] = {
      status: "in_progress",
      runId,
      updatedAt: now.toISOString(),
      ...(was && { before: { status: was.status, updatedAt: was.updatedAt } }),
    };
  }
  return next;
}

/** Gives reserved listings back to the queue, as they were before the run took them. */
export function release(index: BatchIndex, skus: string[]): BatchIndex {
  const next = { ...index };
  for (const s of skus) {
    const e = next[s];
    if (e?.status !== "in_progress") continue;
    if (e.before) next[s] = { status: e.before.status, updatedAt: e.before.updatedAt };
    else delete next[s];
  }
  return next;
}

/** Runs still "started" after 2 hours get "no_answer", and the listings they had not finished go back. */
export function expireRuns(runs: BatchRun[], index: BatchIndex, now: Date): { runs: BatchRun[]; index: BatchIndex } {
  let next = index;
  const out = runs.map((r) => {
    if (r.status !== "started" || now.getTime() - time(r.startedAt) < RUN_TIMEOUT_MS) return r;
    const mine = r.skus.filter((s) => next[s]?.status === "in_progress" && next[s]?.runId === r.id);
    next = release(next, mine);
    return { ...r, status: "no_answer" as const, finishedAt: now.toISOString(), reason: "No answer after 2 hours." };
  });
  return { runs: out, index: next };
}
