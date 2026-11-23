"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui";
import type { Comparable } from "@/lib/ebay/types";
import { detailsFromTitle, type ItemDetails } from "@/lib/ebay/itemDetails";
import { formatMoney } from "./priceRequest";

/** eBay serves the same photo in several sizes; ask for a large one. */
export function largeImage(url: string, size = 1600): string {
  return url.replace(/\/s-l\d+(\.\w+)$/, `/s-l${size}$1`);
}

const COUNTRY: Record<string, string> = { CA: "Canada", US: "USA", GB: "UK", JP: "Japan", DE: "Germany", AU: "Australia", FR: "France" };
const countryName = (code: string | null) => (code ? (COUNTRY[code] ?? code) : null);

type State = { status: "loading" } | { status: "done"; details: ItemDetails } | { status: "error" };

/**
 * Bottom sheet for one sale or listing on the price step: photos, the seller's
 * description, disc and inlay condition, country of origin, and a button to
 * open it on eBay.
 */
export default function ComparableSheet({
  item,
  sold,
  onClose,
}: {
  item: Comparable;
  sold: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/comparable?id=${encodeURIComponent(item.itemId)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((details: ItemDetails) => setState({ status: "done", details }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ status: "error" });
        return e;
      });
    return () => ctrl.abort();
  }, [item.itemId]);

  // Android back (and browser back) closes the sheet instead of leaving the screen.
  const onBack = useEffectEvent(() => onClose());
  useEffect(() => {
    window.history.pushState({ ...window.history.state, compSheet: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function close() {
    if (window.history.state?.compSheet) window.history.back();
    else onClose();
  }

  const details = state.status === "done" && state.details.available ? state.details : null;
  const fromTitle = detailsFromTitle(item.title);
  const loading = state.status === "loading";
  const images = details?.images.length ? details.images : item.imageUrl ? [item.imageUrl] : [];
  const url = details?.url ?? item.url;
  const facts: { label: string; value: string | null }[] = [
    { label: "CD condition", value: details?.disc ?? fromTitle.disc },
    { label: "Inlay condition", value: details?.inlay ?? fromTitle.inlay },
    { label: "Country of origin", value: details?.origin ?? fromTitle.origin },
    { label: "Ships from", value: countryName(details?.shipsFrom ?? item.itemLocation.country) },
    { label: "eBay condition", value: details?.condition ?? item.condition },
  ];
  const ship =
    item.shippingCost === null
      ? null
      : item.shippingCost.value === 0
        ? "free shipping"
        : `+${formatMoney(item.shippingCost.value, item.shippingCost.currency)} shipping`;

  // Portal to <body>: the price cards animate with a transform, which would trap a fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 fade-in" onClick={close}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby="comp-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-background p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{sold ? "Sold listing" : "Current listing"}</p>
            <h2 id="comp-title" className="t-headline line-clamp-3">
              {details?.title ?? item.title}
            </h2>
            <p className="t-small mt-1 text-muted">
              <span className="font-semibold text-foreground">{formatMoney(item.price.value, item.price.currency)}</span>
              {[ship, item.soldDate && `sold ${new Date(item.soldDate).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}`].filter(Boolean).map((s) => ` · ${s}`)}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="icon-btn -mr-2">
            <Icon name="close" />
          </button>
        </div>

        {images.length > 0 && (
          <div className="-mx-4 mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo
              <img
                key={src}
                src={largeImage(src, 800)}
                alt={i === 0 ? item.title : ""}
                loading={i === 0 ? "eager" : "lazy"}
                className={`h-56 shrink-0 snap-center rounded-xl bg-surface-2 object-contain ${images.length > 1 ? "w-[85%]" : "w-full"}`}
              />
            ))}
          </div>
        )}

        <dl className="card mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="t-caption text-muted">{f.label}</dt>
              <dd className="t-small font-medium">
                {f.value ?? (loading ? <span className="skeleton inline-block h-4 w-16 align-middle" /> : <span className="text-muted">Not stated</span>)}
              </dd>
            </div>
          ))}
        </dl>

        {details?.conditionNote && (
          <section className="mt-4">
            <h3 className="label">Seller&apos;s condition notes</h3>
            <p className="t-small whitespace-pre-line">{details.conditionNote}</p>
          </section>
        )}

        <section className="mt-4">
          <h3 className="label">Description</h3>
          {loading ? (
            <div className="space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-5/6" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ) : details?.description ? (
            <p className="t-small max-h-72 overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-surface p-3">
              {details.description}
            </p>
          ) : (
            <p className="t-small text-muted">
              {state.status === "error"
                ? "Couldn't load the description. Open it on eBay to read it."
                : sold
                  ? "eBay no longer shares the description of this ended sale. The grades above come from its title."
                  : "The seller didn't write a description."}
            </p>
          )}
        </section>

        {url && (
          // Stays at the bottom of the sheet while the description scrolls.
          <div className="sticky -bottom-6 -mx-4 mt-4 border-t border-line bg-background px-4 pb-2 pt-3">
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-primary w-full">
              <Icon name="external" /> Open on eBay
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
