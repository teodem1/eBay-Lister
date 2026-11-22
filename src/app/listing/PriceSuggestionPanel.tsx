"use client";

import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { Spinner, StepHeading } from "@/components/ui";
import { formatMoney, type PriceCheck } from "./priceRequest";

type Option = { key: keyof PriceSuggestion["itemPrice"]; label: string };
const OPTIONS: Option[] = [
  { key: "quickSale", label: "Quick" },
  { key: "recommended", label: "Suggested" },
  { key: "high", label: "High" },
];

function PriceCard({
  title,
  subtitle,
  unit,
  suggestion,
  missing,
  selected,
  onPick,
}: {
  title: string;
  subtitle: string;
  /** What each comparable is, e.g. "sales" or "listings". */
  unit: string;
  suggestion: PriceSuggestion | null;
  missing?: string;
  selected: number | undefined;
  onPick: (price: number) => void;
}) {
  const money = (n: number) => formatMoney(n, suggestion?.currency ?? "CAD");
  const has = suggestion !== null && suggestion.usedCount > 0;

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
      ) : (
        <p className="mt-2 text-xs text-muted">
          {missing ?? "No comparable eBay listings found."}
        </p>
      )}
    </div>
  );
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
            subtitle="What buyers paid in the last 90 days"
            unit="sales"
            suggestion={check.sold}
            missing={check.unavailable.sold}
            selected={selected}
            onPick={onPick}
          />
          <PriceCard
            title="Current listings"
            subtitle="What similar items are listed at now"
            unit="listings"
            suggestion={check.current}
            missing={check.unavailable.current}
            selected={selected}
            onPick={onPick}
          />
        </div>
      )}
    </section>
  );
}
