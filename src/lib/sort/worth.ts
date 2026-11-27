/**
 * "Sort a pile": which CDs in one photo are worth listing. Pure helpers (no
 * browser APIs) so they are easy to test; storage lives in ./store.ts.
 *
 * The net is an estimate of what reaches the seller from one sale on eBay.ca:
 *   price
 *   - eBay final value fee on (price + shipping charged)
 *   - Promoted Listings fee on (price + shipping charged)
 *   - eBay per-order fee
 *   - the mailer
 * The shipping the buyer pays is taken to cover the Canada Post label, so it
 * only counts through the fees charged on it.
 */
import type { ShelfCd } from "../identify/shelf";
import { bestSuggestion, type PriceCheck } from "../pricing/priceCheck";

export const SORT_FEES = {
  /** eBay.ca Music (not vinyl), no Store, since March 2025. Check Seller Hub if it changes. */
  finalValuePercent: 14.95,
  /** The seller's Promoted Listings rate on every listing. */
  promotedPercent: 11,
  /** eBay.ca per-order fee: $0.30 up to $10, $0.40 above. */
  orderFee: (total: number) => (total <= 10 ? 0.3 : 0.4),
  /** What the buyer pays for Canada Post shipping to Canada (policy, first CD). */
  shippingCharged: 7.99,
  /** Bubble mailer and tape. */
  packaging: 1,
} as const;

/** Net below this (CAD) is not worth the listing work by default. */
export const DEFAULT_MIN_NET = 5;
export const MIN_NET_CHOICES = [3, 5, 10] as const;
/** At most this many CDs priced per run, so one photo can't eat the month. */
export const MAX_PRICE_PER_RUN = 12;

export function netAfterFees(price: number, fees = SORT_FEES): number {
  const total = price + fees.shippingCharged;
  const percent = (fees.finalValuePercent + fees.promotedPercent) / 100;
  return round2(price - total * percent - fees.orderFee(total) - fees.packaging);
}

export type SortVerdict = "worth" | "low" | "none";

/** Where a price came from: "sold" (last sold copies) or "listed" (current listings only). */
export type PriceFrom = NonNullable<ReturnType<typeof bestSuggestion>>["from"];

export interface SortPrice {
  price: number;
  from: PriceFrom;
  /** How many copies the price uses. */
  count: number;
  net: number;
}

/** One CD read from the photo, and how far it got. */
export interface SortCd {
  id: string;
  artist: string;
  album: string;
  year: string;
  edition: string;
  barcode: string;
  confidence: ShelfCd["confidence"];
  /** Picked for a price check. */
  selected: boolean;
  state: "new" | "pricing" | "priced" | "error";
  check?: PriceCheck;
  /** The check came from the cache or a CD already on To list / Auto (no lookup spent). */
  reused?: boolean;
  error?: string;
  /** Put on the To list tab (its id there). */
  sentId?: string;
}

export interface SortSession {
  createdAt: string;
  /** Small preview of the photo (data URL), so the seller can match rows to CDs. */
  thumb?: string;
  cds: SortCd[];
}

export function sessionFromShelf(cds: ShelfCd[], now = new Date(), thumb?: string): SortSession {
  return {
    createdAt: now.toISOString(),
    thumb,
    cds: cds.map((cd, i) => ({
      id: `${now.getTime().toString(36)}-${i}`,
      artist: cd.artist,
      album: cd.album,
      year: cd.year,
      edition: cd.edition,
      barcode: /^\d{8,14}$/.test(cd.barcode) ? cd.barcode : "",
      confidence: cd.confidence,
      // Low-confidence reads start unticked: a wrong name would waste a lookup.
      selected: i < MAX_PRICE_PER_RUN && cd.confidence !== "low",
      state: "new",
    })),
  };
}

/** The search text for a CD: artist, album and any edition words (so the version filter keeps them). */
export function sortKeywords(cd: Pick<SortCd, "artist" | "album" | "edition">): string {
  return [cd.artist, cd.album, cd.edition].map((s) => s.trim()).filter(Boolean).join(" ");
}

/** Cache key: the search text, lower case, punctuation and spacing ignored. */
export function checkKey(keywords: string, barcode = ""): string {
  const words = keywords
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(cd|the|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return barcode ? `${barcode}|${words}` : words;
}

/** The price to judge a CD by: last sold recommended, else current listings. */
export function sortPrice(check: PriceCheck | undefined, fees = SORT_FEES): SortPrice | null {
  const best = bestSuggestion(check);
  if (!best) return null;
  const price = best.suggestion.itemPrice.recommended;
  return { price, from: best.from, count: best.suggestion.usedCount, net: netAfterFees(price, fees) };
}

export function verdict(cd: SortCd, minNet: number): SortVerdict | null {
  if (cd.state !== "priced") return null;
  const p = sortPrice(cd.check);
  if (!p) return "none";
  return p.net >= minNet ? "worth" : "low";
}

/** Worth selling first (best net first), then too low, then no copies, then the rest in photo order. */
export function rankCds(cds: SortCd[], minNet: number): SortCd[] {
  const order: Record<SortVerdict, number> = { worth: 0, low: 1, none: 2 };
  return cds
    .map((cd, i) => ({ cd, i, v: verdict(cd, minNet), net: sortPrice(cd.check)?.net ?? -Infinity }))
    .sort((a, b) => {
      const va = a.v ? order[a.v] : 3;
      const vb = b.v ? order[b.v] : 3;
      if (va !== vb) return va - vb;
      if (va < 2 && a.net !== b.net) return b.net - a.net;
      return a.i - b.i;
    })
    .map((x) => x.cd);
}

/** A cover photo from the copies a check found, for a CD with no cover of its own. */
export function coverFromCheck(check: PriceCheck | undefined): string | undefined {
  return [...(check?.soldItems ?? []), ...(check?.currentItems ?? [])].find((c) => c.imageUrl)?.imageUrl ?? undefined;
}

/** CDs picked for a price check that still need one, and how many of those spend a lookup. */
export function pricingPlan(cds: SortCd[], cached: (cd: SortCd) => boolean): { all: SortCd[]; paid: number } {
  const all = cds.filter((cd) => cd.selected && (cd.state === "new" || cd.state === "error") && sortKeywords(cd));
  return { all, paid: all.filter((cd) => !cached(cd)).length };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
