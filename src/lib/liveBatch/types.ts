/**
 * Phone-run listing batches: a Claude Code cloud session (the optimise-listing skill's
 * headless job) proposes changes to live listings; the phone shows and applies them.
 * Plain types (and one tiny status check), so the screen can import them without the store or zod.
 */

/** Where a live listing stands in the batch queue. */
/** `review`: the seller sent it to the Review tab, to edit and send later. */
export type EntryStatus = "in_progress" | "open" | "review" | "applied" | "dismissed" | "failed" | "stale";

/** Waiting for the seller: shown on Update live listings (`open`) or in the Review tab (`review`). */
export const isPending = (status: EntryStatus): boolean => status === "open" || status === "review";

export interface IndexEntry {
  status: EntryStatus;
  runId?: string;
  /** When the status last changed (ISO). */
  updatedAt: string;
  /** While reserved: the entry before the run took it, restored if the run gives it back. */
  before?: { status: EntryStatus; updatedAt: string };
}

/** By SKU. */
export type BatchIndex = Record<string, IndexEntry>;

export type EngagementLevel = "high" | "normal" | "low";

export interface Proposal {
  sku: string;
  runId: string;
  createdAt: string;
  /** The live title and price the proposal was made from: apply skips the listing if either changed. */
  snapshot: { title: string; price: number | null };
  title: string;
  addAspects: Record<string, string[]>;
  appendHtml: string;
  price: number | null;
  /** The sales-based price; `price` is listed higher when lowering, so a typical Best Offer lands on it. */
  target?: number | null;
  /** A higher price backed by one matching sale, sent only when the seller accepts it. */
  pendingPrice: number | null;
  evidence: string;
  engagement: { level: EngagementLevel; sold: number; listed: number; monthsOfSupply: number | null; reason: string };
  flags: string[];
  status: EntryStatus;
  result?: { text: string; price: string; reason: string };
  /** The last "Ask Claude" answer: the seller's note, Claude's reply, the sales it found matching (item ids), the
   * re-proposed price (applied to the proposal) and a suggested title (checked; fills the field only on "Use this"). */
  asked?: {
    note: string;
    answer: string;
    matching: string[];
    basis: "matching" | "estimate";
    previousPrice: number | null;
    questions?: string[];
    target: number | null;
    price: number | null;
    title: string | null;
    at: string;
  };
  /** When it was applied, dismissed or skipped (ISO); proposals done over 7 days ago are pruned. */
  doneAt?: string;
}

/** One listing's answer from POST /api/batch/apply. */
export interface ApplyOutcome {
  sku: string;
  status: EntryStatus | "skipped";
  result?: Proposal["result"];
}

export interface BatchRun {
  id: string;
  startedAt: string;
  fiveHour: number;
  weekly: number;
  /** The listings this run reserved. */
  skus: string[];
  status: "started" | "done" | "failed" | "no_answer";
  sessionUrl?: string;
  reason?: string;
  finishedAt?: string;
}
