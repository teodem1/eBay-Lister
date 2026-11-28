/** Pure view logic for the phone batch screen (no React, no fetch), so it is tested on its own. */
import type { BatchRun, Proposal } from "@/lib/listing/types";

const cds = (n: number) => `${n} CD${n === 1 ? "" : "s"}`;

export function runLabel(run: BatchRun, now: Date): string {
  switch (run.status) {
    case "started": {
      const min = Math.max(0, Math.round((now.getTime() - new Date(run.startedAt).getTime()) / 60_000));
      return `Running, started ${min} min ago (${cds(run.skus.length)})`;
    }
    case "done":
      return `Done (${cds(run.skus.length)})`;
    case "failed":
      return `Stopped: ${run.reason ?? "no reason given."}`;
    case "no_answer":
      return "No answer after 2 hours";
  }
}

export function proposalRows(proposals: Proposal[]): { open: Proposal[]; recent: Proposal[] } {
  return {
    open: proposals.filter((p) => p.status === "open"),
    recent: proposals.filter((p) => p.status !== "open" && p.status !== "in_progress"),
  };
}

/** The price before and after; `flag` ("+60%", "-55%") when it moves more than 50%. */
export function priceChange(p: Proposal): { from: number | null; to: number | null; flag?: string } {
  const from = p.snapshot.price;
  const to = p.price;
  if (from === null || to === null || from <= 0) return { from, to };
  const change = (to - from) / from;
  return Math.abs(change) > 0.5 ? { from, to, flag: `${change > 0 ? "+" : "-"}${Math.round(Math.abs(change) * 100)}%` } : { from, to };
}
