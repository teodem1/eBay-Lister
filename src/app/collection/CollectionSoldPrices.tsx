"use client";

import { useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import SoldComparison from "@/app/review/SoldComparison";
import { defaultPrice, fetchPriceSuggestion, formatMoney, priceSuggestionBody, type PriceCheck } from "@/app/listing/priceRequest";
import { autoStore, batchStore } from "@/lib/batch/store";
import { CURRENCY, type CollectionItem } from "@/lib/collection/collection";
import { collectionCheckKey, collectionKeywords, priceChoices } from "@/lib/collection/soldPrices";
import { useSoldQuotaWarning } from "@/lib/pricing/soldLimit";
import { checkFromItems } from "@/lib/sort/worth";
import { priceCache } from "@/lib/sort/store";

type Found = { check: PriceCheck; at?: string };

/** A check already on this phone: the 30-day cache (shared with Sort a pile), else To list or Auto. Free. */
function savedCheck(item: CollectionItem): Found | undefined {
  const key = collectionCheckKey(item);
  const hit = priceCache.entry(key);
  if (hit) return hit;
  const check = checkFromItems([...batchStore.all(), ...autoStore.all()], key);
  return check ? { check } : undefined;
}

/**
 * "Sold prices" in the Collection edit sheet: the last sold copies of this CD
 * next to the price being edited, with one-tap prices to use. A saved check is
 * shown at once; a new one (one sold-comps.com lookup) only runs on tap.
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
          {found.at ? `Checked ${new Date(found.at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : "Saved check"}
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
