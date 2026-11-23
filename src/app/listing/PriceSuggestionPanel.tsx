"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Comparable } from "@/lib/ebay/types";
import type { PriceSuggestion } from "@/lib/pricing/suggestPrice";
import { Icon, Spinner, StepHeading } from "@/components/ui";
import { isHomeCopy, otherVersion } from "@/lib/pricing/version";
import { formatMoney, type PriceCheck } from "./priceRequest";

type Option = { key: keyof PriceSuggestion["itemPrice"]; label: string };
const OPTIONS: Option[] = [
  { key: "quickSale", label: "Quick" },
  { key: "recommended", label: "Suggested" },
  { key: "high", label: "High" },
];

const total = (c: Comparable) => c.price.value + (c.shippingCost?.value ?? 0);

/** eBay serves the same photo in several sizes; ask for the large one. */
function largeImage(url: string): string {
  return url.replace(/\/s-l\d+(\.\w+)$/, "/s-l1600$1");
}

type Preview = { title: string; imageUrl: string | null; url: string | null };

/** Full-screen photo of a sale or listing, with a link to it on eBay. */
function PhotoPreview({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  // Portal to <body>: the price cards animate with a transform, which would trap a fixed overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] fade-in"
      onClick={onClose}
    >
      <div className="flex justify-end">
        <button type="button" className="icon-btn bg-surface" aria-label="Close photo" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        {preview.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo
          <img src={largeImage(preview.imageUrl)} alt={preview.title} className="max-h-full max-w-full rounded-xl object-contain" />
        ) : (
          <p className="t-small text-center text-white/80">No photo came with this sale. Open it on eBay to see the listing photos.</p>
        )}
      </div>
      <div className="mx-auto w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="t-small line-clamp-3 text-white">{preview.title}</p>
        {preview.url && (
          <a href={preview.url} target="_blank" rel="noreferrer" className="btn btn-secondary w-full">
            <Icon name="external" /> Open on eBay
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ComparableList({
  items,
  sold,
  currency,
  selected,
  onPick,
  keywords,
  homeCountry,
}: {
  items: Comparable[];
  sold: boolean;
  currency: string;
  selected: number | undefined;
  onPick: (price: number) => void;
  keywords: string;
  /** Set when the price uses only this country's copies; the list starts filtered to them. */
  homeCountry: string | null;
}) {
  const [sort, setSort] = useState<"price" | "date">(sold ? "date" : "price");
  const [showAll, setShowAll] = useState(false);
  const [onlyHome, setOnlyHome] = useState(homeCountry !== null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const homeItems = homeCountry ? items.filter((c) => isHomeCopy(c, homeCountry) && !otherVersion(c.title, keywords)) : [];
  const homeName = homeCountry === "CA" ? "Canadian" : homeCountry;
  const listed = onlyHome && homeCountry ? homeItems : items;
  const sorted = [...listed].sort((a, b) =>
    sort === "price" ? total(a) - total(b) : (b.soldDate ?? "").localeCompare(a.soldDate ?? ""),
  );
  const shown = showAll ? sorted : sorted.slice(0, 15);
  const money = (n: number, cur = currency) => formatMoney(n, cur);

  return (
    <div className="mt-3">
      {preview && <PhotoPreview preview={preview} onClose={() => setPreview(null)} />}
      {homeCountry && (
        <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Which copies">
          <button type="button" aria-pressed={onlyHome} onClick={() => setOnlyHome(true)} className="chip-toggle">
            {onlyHome && <Icon name="check" size={16} strokeWidth={2.4} />}
            {homeName} copies ({homeItems.length})
          </button>
          <button type="button" aria-pressed={!onlyHome} onClick={() => setOnlyHome(false)} className="chip-toggle">
            {!onlyHome && <Icon name="check" size={16} strokeWidth={2.4} />}
            All ({items.length})
          </button>
        </div>
      )}
      <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1" role="group" aria-label={sold ? "Sort sales" : "Sort listings"}>
        {(["date", "price"] as const)
          .filter((k) => sold || k === "price")
          .map((k) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className="chip-toggle">
              {sort === k && <Icon name="check" size={16} strokeWidth={2.4} />}
              {k === "date" ? "Newest first" : "Cheapest first"}
            </button>
          ))}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {shown.map((c) => {
          const active = selected === c.price.value;
          return (
            <li key={c.itemId} className="flex items-center gap-3 p-2.5">
              <button
                type="button"
                className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-muted"
                aria-label={`See the photo of ${c.title || "this item"}`}
                onClick={() => setPreview({ title: c.title || c.itemId, imageUrl: c.imageUrl ?? null, url: c.url ?? null })}
              >
                {c.imageUrl ? (
                  // eBay thumbnails come from many hosts, so a plain img keeps it simple.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Icon name="disc" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="t-small line-clamp-2 font-medium underline-offset-2 hover:underline">
                    {c.title || c.itemId}
                  </a>
                ) : (
                  <p className="t-small line-clamp-2 font-medium">{c.title || c.itemId}</p>
                )}
                <p className="t-caption mt-0.5 truncate text-muted">
                  {[
                    c.soldDate && shortDate(c.soldDate),
                    c.shippingCost === null
                      ? "shipping ?"
                      : c.shippingCost.value === 0
                        ? "free ship"
                        : `+${money(c.shippingCost.value, c.shippingCost.currency)} ship`,
                    c.condition,
                    c.itemLocation.country,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onPick(c.price.value)}
                className="choice flex min-h-12 shrink-0 flex-col items-end justify-center px-2.5"
                aria-label={`Use ${money(c.price.value, c.price.currency)}`}
              >
                <span className="text-sm font-bold tabular-nums">{money(c.price.value, c.price.currency)}</span>
                <span className={`t-caption ${active ? "text-brand-ink" : "text-muted"}`}>{active ? "Using" : "Use"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > shown.length && (
        <button type="button" className="btn mt-1 w-full text-sm text-brand-ink" onClick={() => setShowAll(true)}>
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}

/** "2026-11-04" -> "Nov 4". */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/**
 * Dot strip: each comparable's item price on one line, with the chosen price
 * marked, so the seller sees where their price sits among real sales.
 */
function PriceStrip({ values, selected, currency }: { values: number[]; selected: number | undefined; currency: string }) {
  const all = selected !== undefined ? [...values, selected] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pos = (v: number) => (max === min ? 50 : ((v - min) / (max - min)) * 100);
  const money = (n: number) => formatMoney(n, currency);
  return (
    <figure className="mt-4" aria-label={`Prices range from ${money(min)} to ${money(max)}`}>
      <div className="relative mx-1.5 h-8">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2" />
        {values.map((v, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted/45 ring-2 ring-surface"
            style={{ left: `${pos(v)}%` }}
          />
        ))}
        {selected !== undefined && (
          <span
            className="absolute top-0 h-8 w-1 -translate-x-1/2 rounded-full bg-brand-ink ring-2 ring-surface"
            style={{ left: `${pos(selected)}%` }}
          />
        )}
      </div>
      <figcaption className="t-caption mt-1 flex justify-between text-muted tabular-nums">
        <span>{money(min)}</span>
        {selected !== undefined && <span className="font-semibold text-brand-ink">Your price {money(selected)}</span>}
        <span>{money(max)}</span>
      </figcaption>
    </figure>
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
  keywords,
}: {
  keywords: string;
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
  // The strip shows the copies the price came from (Canadian ones when it used only those).
  const home = suggestion?.version?.homeCountry;
  const stripItems = home ? items.filter((c) => isHomeCopy(c, home) && !otherVersion(c.title, keywords)) : items;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-headline">{title}</h3>
          <p className="t-small text-muted">{subtitle}</p>
        </div>
        {sold ? (
          <span className="chip shrink-0 border border-line-strong text-foreground">Sold</span>
        ) : (
          <span className="chip shrink-0 border border-line text-muted">Asking</span>
        )}
      </div>

      {has ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {OPTIONS.map((o) => {
              const value = suggestion.itemPrice[o.key];
              const active = selected === value;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick(value)}
                  className="choice min-h-[4.25rem] min-w-0 px-2.5 py-2 text-left"
                >
                  <span className={`t-caption flex items-center gap-1 ${active ? "text-brand-ink" : "text-muted"}`}>
                    {o.label}
                    {active && <Icon name="check" size={14} strokeWidth={2.6} className="ml-auto" />}
                  </span>
                  <span className="block text-base font-bold tabular-nums tracking-tight min-[380px]:text-[1.0625rem]">
                    {money(value)}
                  </span>
                </button>
              );
            })}
          </div>
          {items.length >= 3 && (
            <PriceStrip values={stripItems.map((c) => c.price.value)} selected={selected} currency={suggestion.currency} />
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="fact">
              {suggestion.usedCount} {unit}
            </span>
            <span className="fact">
              <ConfidenceDots level={suggestion.confidence} /> {suggestion.confidence} confidence
            </span>
            <span className="fact">
              +{money(suggestion.assumedShipping)} shipping{suggestion.shippingDestination ? ` to ${suggestion.shippingDestination}` : ""}
            </span>
            {suggestion.byOrigin.slice(0, 3).map((o) => (
              <span key={o.country} className="fact" title={`${o.count} from ${o.country}, ${money(o.medianTotal)} median total`}>
                From {o.country}: {o.count} · {money(o.medianTotal)}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {items.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="mt-3 flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-3.5 text-left text-sm font-semibold active:bg-surface-2"
          >
            {open ? "Hide" : "Compare"} the {items.length} {unit}
            <Icon name="chevron" className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ComparableList
              items={items}
              sold={sold}
              currency={suggestion?.currency ?? "CAD"}
              selected={selected}
              onPick={onPick}
              keywords={keywords}
              homeCountry={suggestion?.version?.homeCountry ?? null}
            />
          )}
        </>
      ) : has ? null : (
        <p className="t-small mt-3 text-muted">{missing ?? "No comparable eBay listings found."}</p>
      )}
    </div>
  );
}

/** Confidence as 1-3 filled dots, so it doesn't rely on the word alone. */
function ConfidenceDots({ level }: { level: "low" | "medium" | "high" }) {
  const n = { low: 1, medium: 2, high: 3 }[level];
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= n ? "bg-brand-ink" : "bg-line-strong"}`} />
      ))}
    </span>
  );
}

function soldSubtitle(items: Comparable[]): string {
  const dates = items.map((i) => i.soldDate).filter((d): d is string => Boolean(d)).sort();
  return dates.length
    ? `What buyers paid, ${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`
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
    <section className="flex flex-col gap-3">
      <StepHeading
        n={2}
        title="Price"
        hint="Pick a price, or type your own later."
        action={
          <button
            type="button"
            className="btn btn-secondary min-h-11 shrink-0 px-4 text-sm"
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
        }
      />

      {error && <p className="notice notice-bad">{error}</p>}

      {loading && !check && (
        <div className="space-y-3" aria-busy>
          {[0, 1].map((i) => (
            <div key={i} className="card space-y-3">
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
        <div className={`space-y-3 fade-in ${loading ? "opacity-60" : ""}`}>
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
            keywords={check.keywords}
          />
          <PriceCard
            title="Current listings"
            subtitle="What similar items are listed at"
            unit="listings"
            suggestion={check.current}
            items={check.currentItems}
            missing={check.unavailable.current}
            selected={selected}
            onPick={onPick}
            keywords={check.keywords}
          />
        </div>
      )}
    </section>
  );
}
