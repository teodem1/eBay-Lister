"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import SoldComparison from "@/app/review/SoldComparison";
import { defaultPrice, fetchPriceSuggestion, formatMoney, priceSuggestionBody, type PriceCheck } from "@/app/listing/priceRequest";
import { autoStore, batchStore } from "@/lib/batch/store";
import { CURRENCY, trimCheck, type CollectionItem } from "@/lib/collection/collection";
import { collectionStore } from "@/lib/collection/store";
import { collectionCheckKey, collectionKeywords, priceChoices } from "@/lib/collection/soldPrices";
import { useSoldQuotaWarning } from "@/lib/pricing/soldLimit";
import { checkFromItems } from "@/lib/sort/worth";
import { priceCache } from "@/lib/sort/store";

type Found = { check: PriceCheck; at?: string };

/**
 * Prices already looked up for this CD, free: the check saved on the CD when it
 * was listed (or checked here before), else the 30-day cache shared with Sort a
 * pile, else a check saved on To list or Auto (same barcode or SKU).
 */
function savedCheck(item: CollectionItem): Found | undefined {
  if (item.priceCheck) return { check: item.priceCheck, at: item.priceCheckedAt };
  const key = collectionCheckKey(item);
  const hit = priceCache.entry(key);
  if (hit) return hit;
  const items = [...batchStore.all(), ...autoStore.all()];
  const bySku = item.sku ? items.find((x) => x.auto?.draft?.sku === item.sku && x.auto?.priceCheck) : undefined;
  const check = bySku?.auto?.priceCheck ?? checkFromItems(items, key);
  return check ? { check } : undefined;
}

/**
 * "Sold prices" in the Collection edit sheet: the last sold copies of this CD
 * next to the price being edited, with one-tap prices to use. Prices already
 * looked up show at once; a new lookup (one sold-comps.com call) only runs on tap.
 */
export default function CollectionSoldPrices({
  item,
  price,
  onPick,
}: {
  item: CollectionItem;
  /** The price in the edit field right now. */
  price?: number;
  onPick: (price: number) => void;
}) {
  const [found, setFound] = useState<Found | undefined>(() => (typeof window === "undefined" ? undefined : savedCheck(item)));
  // Keep a check found elsewhere on the CD itself, so it stays after the cache drops it.
  const kept = useRef(false);
  useEffect(() => {
    if (kept.current || !found || item.priceCheck) return;
    kept.current = true;
    collectionStore.update(item.id, { priceCheck: trimCheck(found.check), priceCheckedAt: found.at });
  }, [found, item]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quota = useSoldQuotaWarning();
  const keywords = collectionKeywords(item);
  const canCheck = !!priceSuggestionBody(keywords, item.barcode ?? "");
  const onEbay = !!(item.sku || item.barcode);

  async function check() {
    const body = priceSuggestionBody(keywords, item.barcode ?? "");
    if (!body) return;
    setLoading(true);
    setError(null);
    const result = await fetchPriceSuggestion(body);
    setLoading(false);
    if ("error" in result) return setError(result.error);
    const at = new Date();
    priceCache.put(collectionCheckKey(item), result, at);
    collectionStore.update(item.id, { priceCheck: trimCheck(result), priceCheckedAt: at.toISOString() });
    setFound({ check: result, at: at.toISOString() });
  }

  const cost =
    quota?.kind === "limit"
      ? "Sold-price lookups are used up this month, so this shows current listings only."
      : "Uses 1 of your sold-price lookups.";

  if (!found) {
    return (
      <section className="rounded-xl border border-line p-3" aria-label="Sold prices">
        <button type="button" className="btn btn-secondary w-full" disabled={!canCheck || loading} onClick={check}>
          {loading ? (
            <>
              <Spinner /> Checking sold prices…
            </>
          ) : (
            <>
              <Icon name="search" size={18} /> Check sold prices
            </>
          )}
        </button>
        <p className="t-caption mt-1.5 text-muted">{canCheck ? cost : "Add the album name first."}</p>
        {error && (
          <p role="alert" className="notice notice-bad t-small mt-2">
            {error}
          </p>
        )}
      </section>
    );
  }

  const offer = priceChoices(found.check);
  const shownPrice = price ?? defaultPrice(found.check) ?? 0;

  return (
    <section className="flex flex-col gap-2" aria-label="Sold prices">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="label mb-0">Sold prices</h3>
        <span className="t-caption text-muted">
          {found.at ? `Looked up ${new Date(found.at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}` : "Looked up earlier"}
          {" · "}
          <button type="button" className="link px-1 py-1" disabled={loading || !canCheck} onClick={check}>
            {loading ? "Checking…" : "Check again"}
          </button>
        </span>
      </div>
      {offer && (
        <>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Use a price">
            {offer.choices.map((c) => (
              <button
                key={c.label}
                type="button"
                className="choice flex min-h-12 min-w-0 flex-col items-start justify-center px-2.5 py-2 text-left"
                aria-pressed={price !== undefined && Math.abs(price - c.value) < 0.005}
                onClick={() => onPick(c.value)}
              >
                <span className="t-caption text-muted">{c.label}</span>
                <span className="t-small font-semibold tabular-nums">{formatMoney(c.value, CURRENCY)}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            Tap a price{offer.from === "listed" ? " (no sales found, so from current listings)" : ""}, then Save.
            {onEbay ? " Saving also changes the price on eBay." : ""}
          </p>
        </>
      )}
      <SoldComparison price={shownPrice} check={found.check} />
      {error && (
        <p role="alert" className="notice notice-bad t-small">
          {error}
        </p>
      )}
      {found.check.soldLimitReached && (
        <p className="t-caption text-muted">Sold-price lookups were used up, so these are current listings.</p>
      )}
    </section>
  );
}
