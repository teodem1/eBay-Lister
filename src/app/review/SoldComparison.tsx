"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import ComparableSheet from "@/app/listing/ComparableSheet";
import { PriceStrip, shortDate } from "@/app/listing/PriceSuggestionPanel";
import { formatMoney, type PriceCheck } from "@/app/listing/priceRequest";
import { compareToComparables } from "@/lib/auto/auto";
import type { Comparable } from "@/lib/ebay/types";

const SHOWN = 5;

/**
 * A published listing next to the last sold copies its price check found
 * (saved on the phone, so no new sold-price check): where the price sits on a
 * strip, the range and median, and the sales themselves (tap one for details).
 * Falls back to the current listings when nothing sold.
 */
export default function SoldComparison({ price, check }: { price: number; check?: PriceCheck }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<Comparable | null>(null);
  const cmp = compareToComparables(price, check);
  if (!check || !cmp) {
    return <p className="t-small rounded-xl bg-surface-2 p-3 text-muted">No sold or listed copies were found for this CD.</p>;
  }

  const sold = cmp.basis === "sold";
  const items = [...(sold ? check.soldItems : check.currentItems)].sort((a, b) =>
    sold ? (b.soldDate ?? "").localeCompare(a.soldDate ?? "") : a.price.value - b.price.value,
  );
  const currency = items[0]?.price.currency ?? "CAD";
  const money = (n: number) => formatMoney(n, currency);
  const shown = showAll ? items : items.slice(0, SHOWN);
  const diff = price - cmp.median;
  const vsMedian =
    Math.abs(diff) < 0.5 ? "about the same as the median" : `${money(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the median`;

  return (
    <section className="rounded-xl border border-line p-3" aria-label={sold ? "Compared with last sold" : "Compared with current listings"}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="t-small font-semibold">{sold ? "Compared with last sold" : "No sales found: current listings"}</h3>
        <span className="t-caption text-muted tabular-nums">
          {cmp.count} {sold ? (cmp.count === 1 ? "sale" : "sales") : cmp.count === 1 ? "listing" : "listings"}
        </span>
      </div>
      <PriceStrip values={items.map((c) => c.price.value)} selected={price} currency={currency} />
      <p className="t-small mt-2">
        {sold ? "Sold" : "Listed"} for {money(cmp.min)} to {money(cmp.max)}, median {money(cmp.median)}. Your price is {vsMedian}
        {cmp.count > 1 && (
          <>
            , higher than {cmp.cheaper} of {cmp.count}
          </>
        )}
        .
      </p>

      <button
        type="button"
        className="t-small mt-2 flex min-h-10 w-full items-center justify-between font-medium text-brand-ink"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "See"} the {sold ? "sales" : "listings"}
        <Icon name="chevron" size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {shown.map((c) => (
              <li key={c.itemId}>
                <button type="button" className="flex w-full items-center gap-3 p-2.5 text-left active:bg-surface-2" onClick={() => setDetail(c)}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted">
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- eBay thumbnails come from many hosts
                      <img src={c.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="disc" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-small line-clamp-2 font-medium">{c.title || c.itemId}</span>
                    <span className="t-caption block truncate text-muted">
                      {[
                        c.soldDate && shortDate(c.soldDate.slice(0, 10)),
                        c.shippingCost === null
                          ? null
                          : c.shippingCost.value === 0
                            ? "free ship"
                            : `+${formatMoney(c.shippingCost.value, c.shippingCost.currency)} ship`,
                        c.condition,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatMoney(c.price.value, c.price.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {items.length > shown.length && (
            <button type="button" className="btn mt-1 w-full text-sm text-brand-ink" onClick={() => setShowAll(true)}>
              Show all {items.length}
            </button>
          )}
        </>
      )}
      {detail && <ComparableSheet item={detail} sold={sold} onClose={() => setDetail(null)} />}
    </section>
  );
}
