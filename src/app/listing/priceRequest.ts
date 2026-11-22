import type { Comparable, ComparableQuery } from "@/lib/ebay/types";
import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";

/** A product barcode (UPC/EAN/GTIN) is 8 to 14 digits. */
export function isGtin(code: string): boolean {
  return /^\d{8,14}$/.test(code.trim());
}

/**
 * Body for POST /api/price-suggestion from what the listing screen knows.
 * A valid barcode is sent as a GTIN (the server prefers it over keywords);
 * the item text always goes along as keywords. Returns null when there is
 * nothing to search on.
 */
export function priceSuggestionBody(query: string, barcode: string): ComparableQuery | null {
  const keywords = query.trim();
  const code = barcode.trim();
  const body: ComparableQuery = {};
  if (keywords) body.keywords = keywords;
  if (isGtin(code)) body.gtin = code;
  return body.keywords || body.gtin ? body : null;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface PriceCheck {
  /** From active eBay listings right now (asking prices). */
  current: PriceSuggestion | null;
  /** From items sold recently (SOLD_LOOKBACK_DAYS, default a year). */
  sold: PriceSuggestion | null;
  /** The listings behind each price, so the seller can compare them. */
  currentItems: Comparable[];
  soldItems: Comparable[];
  /** Why a price is missing, shown to the user. */
  unavailable: { current?: string; sold?: string };
}

/** The price to prefill: last-sold recommended when there is one, else current. */
export function defaultPrice(check: PriceCheck): number | undefined {
  const usable = (s: PriceSuggestion | null) => (s && s.usedCount > 0 ? s : null);
  return (usable(check.sold) ?? usable(check.current))?.itemPrice.recommended;
}

/** Calls POST /api/price-suggestion. Never throws: failures come back as { error }. */
export async function fetchPriceSuggestion(
  body: ComparableQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceCheck | { error: string }> {
  try {
    const res = await fetchImpl("/api/price-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !("current" in data || "sold" in data)) return { error: data?.error ?? "Price check failed" };
    return {
      current: data.current?.suggestion ?? null,
      sold: data.sold?.suggestion ?? null,
      currentItems: data.current?.comparables?.items ?? [],
      soldItems: data.sold?.comparables?.items ?? [],
      unavailable: data.unavailable ?? {},
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Price check failed" };
  }
}
