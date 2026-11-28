/**
 * Learning from the seller's own sales (seller, 2026-11-28). When a CD is marked sold in Collection, its
 * sale price is placed among the stored sold copies of that CD (a percentile) and saved with the CD's
 * engagement at that moment. When live listings are updated, CDs at that engagement level are priced at the
 * average percentile the seller's own sales reached, once the level has 5 or more sales (each CD is sold once,
 * so the level is what carries over). No feedback is shown; it only refines future price proposals.
 */
import type { EngagementLevel } from "../liveBatch/types";

export const MIN_LEVEL_SALES = 5;
const MIN_SALES = 3;
const MIN_SALE = 1;
const DAY = 86_400_000;

export interface SaleOutcome {
  /** The CD's storage key (barcode, else short name), as stored lookups use. */
  key: string;
  barcode?: string;
  name: string;
  soldAt: string;
  soldPrice: number;
  /** Where the sale price sits among the stored same-grade sales (0-100); null with fewer than 3. */
  percentile: number | null;
  salesCount: number;
  median: number | null;
  /** Copies listed on eBay when it was marked sold; null when that could not be read. */
  listedNow: number | null;
  level: EngagementLevel | null;
  recordedAt: string;
}

function sane(values: number[]): number[] {
  const kept = values.filter((v) => Number.isFinite(v) && v >= MIN_SALE);
  if (!kept.length) return kept;
  const floor = median(kept) / 3;
  return kept.filter((v) => v >= floor);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Where `value` sits among the sales (0-100; an equal sale counts half), junk sales left out; null under 3 sales. */
export function percentileOf(value: number, values: number[]): number | null {
  const sales = sane(values);
  if (sales.length < MIN_SALES) return null;
  const below = sales.filter((v) => v < value).length;
  const equal = sales.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / sales.length) * 100);
}

/** Copies listed now against the sales pace, as the skill's reprice.engagement_level: <=3 months high, >=12 low. */
export function engagementLevel(sales: { soldDate: string | null }[], savedAt: string, listed: number): EngagementLevel {
  const end = new Date(savedAt).getTime();
  const dates = sales.filter((s) => s.soldDate).map((s) => new Date(s.soldDate!.slice(0, 10)).getTime());
  const days = dates.length ? Math.max(30, Math.round((end - Math.min(...dates)) / DAY)) : 365;
  const sold = sales.length;
  if (sold === 0) return listed ? "low" : "normal";
  const supply = listed / (sold / (days / 30));
  return supply <= 3 ? "high" : supply >= 12 ? "low" : "normal";
}

/** The learned price position for an engagement level: the average percentile of its sales (5+), kept 10-90. */
export function learnedPosition(outcomes: SaleOutcome[], level: EngagementLevel): { percentile: number; n: number } | null {
  const atLevel = outcomes.filter((o) => o.percentile !== null && o.level === level);
  if (atLevel.length < MIN_LEVEL_SALES) return null;
  const mean = atLevel.reduce((s, o) => s + o.percentile!, 0) / atLevel.length;
  return { percentile: Math.min(90, Math.max(10, Math.round(mean))), n: atLevel.length };
}
