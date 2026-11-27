import type { ComparableQuery } from "@/lib/ebay/types";
import type { Condition } from "@/lib/ebay/sell";
import { bestSuggestion, type PriceCheck } from "../../lib/pricing/priceCheck";
import { noteSoldQuota } from "../../lib/pricing/soldLimit";

export type { PriceCheck };

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
export function priceSuggestionBody(
  query: string,
  barcode: string,
  sellerCondition?: Condition,
): (ComparableQuery & { sellerCondition?: Condition }) | null {
  const keywords = query.trim();
  const code = barcode.trim();
  const body: ComparableQuery & { sellerCondition?: Condition } = {};
  if (sellerCondition) body.sellerCondition = sellerCondition;
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


/** The price to prefill: last-sold recommended when there is one, else current. */
export function defaultPrice(check: PriceCheck): number | undefined {
  return bestSuggestion(check)?.suggestion.itemPrice.recommended;
}

/** A failed price check. `soldLimitReached` when the sold-comps allowance is used up. */
export type PriceCheckError = { error: string; soldLimitReached?: boolean };

/** Calls POST /api/price-suggestion. Never throws: failures come back as { error }. */
export async function fetchPriceSuggestion(
  body: ComparableQuery & { sellerCondition?: Condition },
  fetchImpl: typeof fetch = fetch,
): Promise<PriceCheck | PriceCheckError> {
  try {
    const res = await fetchImpl("/api/price-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    noteSoldQuota(data);
    if (!res.ok || !("current" in data || "sold" in data)) {
      return { error: data?.error ?? "Price check failed", soldLimitReached: data?.soldLimitReached || undefined };
    }
    return {
      soldLimitReached: data.soldLimitReached || undefined,
      soldRemaining: data.soldRemaining,
      current: data.current?.suggestion ?? null,
      sold: data.sold?.suggestion ?? null,
      keywords: body.keywords ?? "",
      currentItems: data.current?.comparables?.items ?? [],
      soldItems: data.sold?.comparables?.items ?? [],
      unavailable: data.unavailable ?? {},
      condition: body.sellerCondition,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Price check failed" };
  }
}
