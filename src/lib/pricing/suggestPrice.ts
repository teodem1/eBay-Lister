/**
 * Turns comparable listings into a price suggestion.
 *
 * Pure functions only, no network: feed it a ComparableResult.
 *
 * Approach:
 *  1. Work on the total the buyer pays (item + shipping), because buyers
 *     compare totals. Items with unknown shipping count as free shipping.
 *  2. Drop outliers with the IQR rule (broken items, bundles, typos).
 *  3. Weight each comparable by quantity sold and by recency.
 *  4. Suggest quick-sale / recommended / high totals from weighted
 *     percentiles, then subtract the seller's own shipping charge to get
 *     the item price.
 *  5. If the data are active asking prices (no sold data), discount them.
 */
import type { Comparable, ComparableResult, ComparableSource } from "../ebay/types";
import { selectSameVersion } from "./version";

export interface PriceOptions {
  /** What the seller will charge for shipping. Default: median comparable shipping. */
  myShippingCost?: number;
  /**
   * GUESS: how much lower sold prices are than active asking prices. Only
   * used for the Browse fallback. 15% is a rough rule of thumb, not measured.
   */
  activeListingDiscount?: number;
  /** Half-life for recency weighting, in days. GUESS: 30. */
  recencyHalfLifeDays?: number;
  /** "Now", for recency weighting. Injected for tests. */
  now?: Date;
  /** The seller's item text; other versions it doesn't mention (Japanese, vinyl...) are left out. */
  keywords?: string;
  /** Price from copies of this country (e.g. "CA") when there are enough. */
  homeCountry?: string;
  /** What a comparable is called in notes ("sales", "listings"). */
  unit?: string;
}

export interface Stats {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
}

export interface OriginBreakdown {
  country: string;
  count: number;
  medianTotal: number;
  medianShipping: number | null;
}

export interface PriceSuggestion {
  currency: string;
  source: ComparableSource;
  /** low / medium / high, from sample size and spread. */
  confidence: "low" | "medium" | "high";
  /** Item price to list at (shipping charged separately). */
  itemPrice: { quickSale: number; recommended: number; high: number };
  /** Shipping charge the item prices assume. */
  assumedShipping: number;
  /** Stats over total (item + shipping) after outlier removal. */
  totals: Stats;
  /** Stats over shipping cost of comparables that quoted one. */
  shipping: Stats | null;
  /** Comparables grouped by the country the item ships from. */
  byOrigin: OriginBreakdown[];
  /** Destination the shipping costs were quoted for. */
  shippingDestination: string | null;
  usedCount: number;
  outliersRemoved: number;
  /** Comparables skipped because their currency differs from the majority. */
  otherCurrencySkipped: number;
  notes: string[];
  /** Which comparables the prices use: other versions left out, home-country copies only. */
  version: { otherVersionsLeftOut: number; homeCountry: string | null };
}

const DAY_MS = 86_400_000;

export function total(c: Comparable): number {
  return c.price.value + (c.shippingCost?.value ?? 0);
}

/** Linear-interpolated percentile on a sorted array, p in [0, 1]. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Weighted percentile: smallest value whose cumulative weight reaches p. */
export function weightedPercentile(
  values: { v: number; w: number }[],
  p: number,
): number {
  const s = [...values].sort((a, b) => a.v - b.v);
  const totalW = s.reduce((acc, x) => acc + x.w, 0);
  let cum = 0;
  for (const x of s) {
    cum += x.w;
    if (cum / totalW >= p) return x.v;
  }
  return s[s.length - 1]?.v ?? NaN;
}

export function stats(values: number[]): Stats {
  const s = [...values].sort((a, b) => a - b);
  return {
    count: s.length,
    min: s[0],
    p25: percentile(s, 0.25),
    median: percentile(s, 0.5),
    p75: percentile(s, 0.75),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

/** Keeps values within [Q1 - 1.5·IQR, Q3 + 1.5·IQR]. Needs 4+ items to act. */
export function removeOutliers(items: Comparable[]): Comparable[] {
  if (items.length < 4) return items;
  const s = items.map(total).sort((a, b) => a - b);
  const q1 = percentile(s, 0.25);
  const q3 = percentile(s, 0.75);
  const iqr = q3 - q1;
  return items.filter((c) => {
    const t = total(c);
    return t >= q1 - 1.5 * iqr && t <= q3 + 1.5 * iqr;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ends the price in .99 / .49 style the way most eBay sellers do. */
export function charmPrice(n: number): number {
  if (n < 1) return round2(n);
  const whole = Math.floor(n);
  return n - whole >= 0.5 ? whole + 0.99 : Math.max(0.99, whole - 1 + 0.99);
}

function mostCommonCurrency(items: Comparable[]): string {
  const counts = new Map<string, number>();
  for (const c of items) counts.set(c.price.currency, (counts.get(c.price.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function byOrigin(items: Comparable[]): OriginBreakdown[] {
  const groups = new Map<string, Comparable[]>();
  for (const c of items) {
    const k = c.itemLocation.country ?? "unknown";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()]
    .map(([country, cs]) => {
      const ship = cs.filter((c) => c.shippingCost).map((c) => c.shippingCost!.value);
      return {
        country,
        count: cs.length,
        medianTotal: round2(stats(cs.map(total)).median),
        medianShipping: ship.length ? round2(stats(ship).median) : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function suggestPrice(
  result: ComparableResult,
  opts: PriceOptions = {},
): PriceSuggestion | null {
  const notes = [...result.notes];
  const currency = mostCommonCurrency(result.items);
  const sameCurrency = result.items.filter((c) => c.price.currency === currency);
  const otherCurrencySkipped = result.items.length - sameCurrency.length;
  if (otherCurrencySkipped) {
    notes.push(`${otherCurrencySkipped} comparables in another currency were left out.`);
  }
  if (!sameCurrency.length) return null;

  // Barcode matches are already the seller's exact pressing, wherever the seller is.
  const version = selectSameVersion(sameCurrency, {
    keywords: opts.keywords,
    homeCountry: result.matchedBy === "barcode" ? undefined : opts.homeCountry,
    unit: opts.unit,
  });
  notes.push(...version.notes);
  const kept = removeOutliers(version.items);
  const outliersRemoved = version.items.length - kept.length;

  const now = (opts.now ?? new Date()).getTime();
  const halfLife = opts.recencyHalfLifeDays ?? 30;
  const weighted = kept.map((c) => {
    const ageDays = c.soldDate ? Math.max(0, (now - Date.parse(c.soldDate)) / DAY_MS) : 0;
    const recency = c.soldDate ? Math.pow(0.5, ageDays / halfLife) : 1;
    return { v: total(c), w: c.quantitySold * recency };
  });

  const shipValues = kept.filter((c) => c.shippingCost).map((c) => c.shippingCost!.value);
  const shipping = shipValues.length ? stats(shipValues) : null;
  if (kept.length - shipValues.length > 0) {
    notes.push(
      kept.length - shipValues.length === 1
        ? "1 comparable had no shipping cost quoted and was counted as free shipping."
        : `${kept.length - shipValues.length} comparables had no shipping cost quoted and were counted as free shipping.`,
    );
  }

  const discount =
    result.source === "browse_active" ? opts.activeListingDiscount ?? 0.15 : 0;
  const adj = (t: number) => t * (1 - discount);

  const assumedShipping = round2(opts.myShippingCost ?? shipping?.median ?? 0);
  const itemFor = (t: number) => charmPrice(Math.max(0.99, adj(t) - assumedShipping));

  const totals = stats(kept.map(total));
  const spread = totals.median ? (totals.p75 - totals.p25) / totals.median : 1;
  let confidence: PriceSuggestion["confidence"] =
    kept.length >= 20 && spread < 0.4 ? "high" : kept.length >= 8 && spread < 0.8 ? "medium" : "low";
  if (result.source === "browse_active" && confidence === "high") confidence = "medium";
  if (kept.length < 5) notes.push("Few comparables found, treat the suggestion as a rough guide.");

  return {
    currency,
    source: result.source,
    confidence,
    itemPrice: {
      quickSale: itemFor(weightedPercentile(weighted, 0.25)),
      recommended: itemFor(weightedPercentile(weighted, 0.5)),
      high: itemFor(weightedPercentile(weighted, 0.75)),
    },
    assumedShipping,
    totals,
    shipping,
    byOrigin: byOrigin(kept),
    shippingDestination: kept[0]?.shippingDestination ?? null,
    usedCount: kept.length,
    outliersRemoved,
    otherCurrencySkipped,
    notes,
    version: { otherVersionsLeftOut: version.otherVersionsLeftOut, homeCountry: version.homeCountry },
  };
}
