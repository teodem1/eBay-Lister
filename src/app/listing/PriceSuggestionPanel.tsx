"use client";

import { useState } from "react";
import type { Comparable } from "@/lib/ebay/types";
import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { Spinner, StepHeading } from "@/components/ui";
import { formatMoney, type PriceCheck } from "./priceRequest";

type Option = { key: keyof PriceSuggestion["itemPrice"]; label: string };
const OPTIONS: Option[] = [
  { key: "quickSale", label: "Quick" },
  { key: "recommended", label: "Suggested" },
  { key: "high", label: "High" },
];

const total = (c: Comparable) => c.price.value + (c.shippingCost?.value ?? 0);

function ComparableList({
  items,
  sold,
  currency,
  onPick,
}: {
  items: Comparable[];
  sold: boolean;
  currency: string;
  onPick: (price: number) => void;
}) {
  const [sort, setSort] = useState<"price" | "date">(sold ? "date" : "price");
  const [showAll, setShowAll] = useState(false);
  const sorted = [...items].sort((a, b) =>
    sort === "price" ? total(a) - total(b) : (b.soldDate ?? "").localeCompare(a.soldDate ?? ""),
  );
  const shown = showAll ? sorted : sorted.slice(0, 15);
  const money = (n: number, cur = currency) => formatMoney(n, cur);

  return (
    <div className="mt-2">
      {sold && (
        <div className="mb-1.5 flex gap-1.5 text-xs">
          {(["date", "price"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sort === k}
              onClick={() => setSort(k)}
              className={`chip ${sort === k ? "bg-brand text-brand-fg" : "bg-surface text-muted"}`}
            >
              {k === "date" ? "Newest first" : "Cheapest first"}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {shown.map((c) => (
          <li key={c.itemId} className="flex items-center gap-2.5 p-2">
            {c.imageUrl ? (
              // eBay thumbnails come from many hosts, so a plain img keeps it simple.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-surface-2 object-cover" />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-lg bg-surface-2" />
            )}
            <div className="min-w-0 flex-1">
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-xs font-medium leading-snug underline-offset-2 hover:underline">
                  {c.title || c.itemId}
                </a>
              ) : (
                <p className="line-clamp-2 text-xs font-medium leading-snug">{c.title || c.itemId}</p>
              )}
              <p className="mt-0.5 truncate text-[0.6875rem] text-muted">
                {[
                  c.soldDate && `sold ${c.soldDate}`,
                  c.shippingCost === null
                    ? "shipping ?"
                    : c.shippingCost.value === 0
                      ? "free shipping"
                      : `+${money(c.shippingCost.value, c.shippingCost.currency)} ship`,
                  c.condition,
                  c.itemLocation.country && `from ${c.itemLocation.country}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onPick(c.price.value)}
              className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-right active:scale-[0.97]"
              title="Use this price"
            >
              <span className="block text-sm font-bold tabular-nums">{money(c.price.value, c.price.currency)}</span>
              <span className="block text-[0.625rem] text-muted">Use</span>
            </button>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && (
        <button type="button" className="mt-1.5 w-full text-center text-xs font-medium text-muted underline" onClick={() => setShowAll(true)}>
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}

function PriceCard({
  title,
  subtitle,
  unit,
  suggestion,
  items,
  sold = false,
  missing,
  selected,
  onPick,
}: {
  title: string;
  subtitle: string;
  /** What each comparable is, e.g. "sales" or "listings". */
  unit: string;
  suggestion: PriceSuggestion | null;
  items: Comparable[];
  sold?: boolean;
  missing?: string;
  selected: number | undefined;
  onPick: (price: number) => void;
}) {
  const money = (n: number) => formatMoney(n, suggestion?.currency ?? "CAD");
  const has = suggestion !== null && suggestion.usedCount > 0;
  const [open, setOpen] = useState(false);

  return (
    <div className="-mx-1 rounded-2xl bg-surface-2 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold tracking-tight">{title}</p>
        {has && (
          <span className="chip bg-surface text-muted">
            {suggestion.usedCount} {unit}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{subtitle}</p>

      {has ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {OPTIONS.map((o) => {
              const value = suggestion.itemPrice[o.key];
              const active = selected === value;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick(value)}
                  className={`min-h-16 min-w-0 rounded-xl border px-2 py-2 text-left transition-all active:scale-[0.97] ${
                    active
                      ? "border-brand bg-brand text-brand-fg shadow-lift"
                      : "border-line bg-surface"
                  }`}
                >
                  <span className={`block truncate text-xs font-medium ${active ? "opacity-85" : "text-muted"}`}>{o.label}</span>
                  <span className="block text-[0.9375rem] font-bold tabular-nums tracking-tight min-[380px]:text-base">{money(value)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {suggestion.usedCount} {unit}, {suggestion.confidence} confidence. Before shipping; assumes you charge{" "}
            {money(suggestion.assumedShipping)}
            {suggestion.shippingDestination ? ` to ${suggestion.shippingDestination}` : ""}.
            {suggestion.byOrigin.length > 0 &&
              ` Ships from ${suggestion.byOrigin
                .slice(0, 3)
                .map((o) => `${o.country} (${o.count}, ${money(o.medianTotal)} total)`)
                .join(", ")}.`}
          </p>
          {suggestion.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-warn-ink">
              {suggestion.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {items.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm font-medium"
          >
            {open ? "Hide" : "Compare"} the {items.length} {unit} {open ? "▴" : "▾"}
          </button>
          {open && <ComparableList items={items} sold={sold} currency={suggestion?.currency ?? "CAD"} onPick={onPick} />}
        </>
      ) : has ? null : (
        <p className="mt-2 text-xs text-muted">
          {missing ?? "No comparable eBay listings found."}
        </p>
      )}
    </div>
  );
}

function soldSubtitle(items: Comparable[]): string {
  const dates = items.map((i) => i.soldDate).filter((d): d is string => Boolean(d)).sort();
  return dates.length
    ? `What buyers paid, sales from ${dates[0]} to ${dates[dates.length - 1]}`
    : "What buyers paid in the past year";
}

export default function PriceSuggestionPanel({
  check,
  loading,
  error,
  selected,
  onPick,
  onRefresh,
}: {
  check: PriceCheck | null;
  loading: boolean;
  error: string | null;
  selected: number | undefined;
  onPick: (price: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="card">
      <div className="flex items-start justify-between gap-2">
        <StepHeading n={2} title="Price" hint="Pick a suggestion or type your own later." />
        <button
          type="button"
          className="btn btn-secondary min-h-9 shrink-0 px-3.5 text-sm"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? (
            <>
              <Spinner className="h-4 w-4" /> Checking
            </>
          ) : check ? (
            "Refresh"
          ) : (
            "Check prices"
          )}
        </button>
      </div>

      {error && <p className="notice notice-bad mt-3">{error}</p>}

      {loading && !check && (
        <div className="mt-3 space-y-2" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-line p-3">
              <div className="skeleton h-4 w-1/3" />
              <div className="grid grid-cols-3 gap-2">
                <div className="skeleton h-16" />
                <div className="skeleton h-16" />
                <div className="skeleton h-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {check && (
        <div className={`mt-3 space-y-2 fade-in ${loading ? "opacity-60" : ""}`}>
          <PriceCard
            title="Last sold"
            subtitle={soldSubtitle(check.soldItems)}
            unit="sales"
            suggestion={check.sold}
            items={check.soldItems}
            sold
            missing={check.unavailable.sold}
            selected={selected}
            onPick={onPick}
          />
          <PriceCard
            title="Current listings"
            subtitle="What similar items are listed at now"
            unit="listings"
            suggestion={check.current}
            items={check.currentItems}
            missing={check.unavailable.current}
            selected={selected}
            onPick={onPick}
          />
        </div>
      )}
    </section>
  );
}
