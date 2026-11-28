/** View logic for the phone batch screen and Review (no React), so it is tested on its own; `request` wraps fetch. */
import type { BatchRun, Proposal } from "@/lib/listing/types";
import { isPending } from "@/lib/liveBatch/types";

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

export function proposalRows(proposals: Proposal[]): { open: Proposal[]; review: Proposal[]; recent: Proposal[] } {
  return {
    open: proposals.filter((p) => p.status === "open"),
    review: proposals.filter((p) => p.status === "review"),
    recent: proposals.filter((p) => !isPending(p.status) && p.status !== "in_progress"),
  };
}

/** The price before and after (`to`: the seller's edited price, else the proposal's); `flag` ("+60%", "-55%") when it moves more than 50%. */
export function priceChange(p: Proposal, to: number | null = p.price): { from: number | null; to: number | null; flag?: string } {
  const from = p.snapshot.price;
  if (from === null || to === null || from <= 0) return { from, to };
  const change = (to - from) / from;
  return Math.abs(change) > 0.5 ? { from, to, flag: `${change > 0 ? "+" : "-"}${Math.round(Math.abs(change) * 100)}%` } : { from, to };
}

/** A JSON request that never throws: a dropped connection comes back as an error answer, so the screen never stays busy. */
export async function request<T>(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  try {
    const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "No connection to the app. Check the phone's connection and try again." } as T };
  }
}

/** What "Yes, update" sends: only the proposals shown when Update was tapped, still open and still ticked. */
export function toSend(shown: string[], open: Proposal[], skipped: Set<string>): string[] {
  const stillOpen = new Set(open.map((p) => p.sku));
  return shown.filter((sku) => stillOpen.has(sku) && !skipped.has(sku));
}

/**
 * Flags the seller must see without tapping "Why?": a pending price and sales from a short-name search.
 * The over-50% change is not one of them: the card works it out from the price shown (`priceChange`),
 * so it stays right after an edit or an Ask Claude price.
 */
export function warnings(p: Proposal): string[] {
  return p.flags.filter((f) => /pending|short[- ]name/i.test(f));
}

/** The flags left for "Why?" (writer notes, Best Offer room, Ask Claude's price note). */
export function notes(p: Proposal): string[] {
  const shown = new Set(warnings(p));
  return p.flags.filter((f) => !shown.has(f));
}

const NOTE_MAX = 600;

/** The seller's note plus their answers to Claude's questions ("Q: ... A: ..."), within 600 characters; answers win. */
export function followUpNote(note: string, answers: { question: string; answer: string }[]): string {
  const extra = answers
    .filter((a) => a.answer.trim())
    .map((a) => `Q: ${a.question.trim()} A: ${a.answer.trim()}`)
    .join("\n")
    .slice(0, NOTE_MAX);
  if (!extra) return note.trim().slice(0, NOTE_MAX);
  const room = NOTE_MAX - extra.length - 1;
  const kept = room > 0 ? note.trim().slice(0, room) : "";
  return kept ? `${kept}\n${extra}` : extra;
}
