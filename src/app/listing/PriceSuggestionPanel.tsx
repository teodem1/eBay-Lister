"use client";

import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { formatMoney } from "./priceRequest";

const SOURCE_LABEL: Record<string, string> = {
  marketplace_insights: "recent eBay sold prices",
  browse_active: "current eBay asking prices",
};

type Option = { key: keyof PriceSuggestion["itemPrice"]; label: string; hint: string };
const OPTIONS: Option[] = [
  { key: "quickSale", label: "Quick sale", hint: "sells fast" },
  { key: "recommended", label: "Recommended", hint: "best balance" },
  { key: "high", label: "High", hint: "wait for a buyer" },
];

export default function PriceSuggestionPanel({
  suggestion,
  loading,
  error,
  selected,
  onPick,
  onRefresh,
}: {
  suggestion: PriceSuggestion | null;
  loading: boolean;
  error: string | null;
  selected: number | undefined;
  onPick: (price: number) => void;
  onRefresh: () => void;
}) {
  const money = (n: number) => formatMoney(n, suggestion?.currency ?? "CAD");

  return (
    <div className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <p className="font-medium">Suggested price</p>
        <button
          type="button"
          className="text-sm font-medium text-blue-600 disabled:opacity-50 dark:text-blue-400"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "Checking eBay…" : suggestion ? "Refresh" : "Check sold prices"}
        </button>
      </div>

      {error && <p className="mt-2 text-red-700 dark:text-red-300">{error}</p>}

      {suggestion && suggestion.usedCount > 0 && (
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
                  <span className="block text-xs opacity-70">{o.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            From {suggestion.usedCount} {SOURCE_LABEL[suggestion.source] ?? "eBay listings"}, {suggestion.confidence}{" "}
            confidence. Prices are before shipping; they assume you charge {money(suggestion.assumedShipping)} shipping
            {suggestion.shippingDestination ? ` to ${suggestion.shippingDestination}` : ""}.
          </p>
          {suggestion.byOrigin.length > 0 && (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Ships from:{" "}
              {suggestion.byOrigin
                .slice(0, 3)
                .map((o) => `${o.country} (${o.count}, ${money(o.medianTotal)} total)`)
                .join(", ")}
            </p>
          )}
          {suggestion.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
              {suggestion.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {suggestion && suggestion.usedCount === 0 && (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">No comparable eBay listings found. Enter a price yourself.</p>
      )}
    </div>
  );
}
