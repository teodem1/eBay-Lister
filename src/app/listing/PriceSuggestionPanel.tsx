"use client";

import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { formatMoney, type PriceCheck } from "./priceRequest";

type Option = { key: keyof PriceSuggestion["itemPrice"]; label: string };
const OPTIONS: Option[] = [
  { key: "quickSale", label: "Quick" },
  { key: "recommended", label: "Recommended" },
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
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{subtitle}</p>

      {has ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {OPTIONS.map((o) => {
              const value = suggestion.itemPrice[o.key];
              const active = selected === value;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick(value)}
                  className={`rounded-lg border px-2 py-2 text-left ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  <span className="block text-xs">{o.label}</span>
                  <span className="block text-base font-semibold">{money(value)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
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
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
              {suggestion.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
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
    <div className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <p className="font-medium">Suggested prices</p>
        <button
          type="button"
          className="text-sm font-medium text-blue-600 disabled:opacity-50 dark:text-blue-400"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "Checking eBay…" : check ? "Refresh" : "Check prices"}
        </button>
      </div>

      {error && <p className="mt-2 text-red-700 dark:text-red-300">{error}</p>}

      {check && (
        <div className="mt-2 space-y-2">
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
    </div>
  );
}
