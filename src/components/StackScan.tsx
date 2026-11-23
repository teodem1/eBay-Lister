"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { normalizeGtin } from "@/lib/identify/barcode";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";
import { batchItemName, type BatchItem } from "@/lib/batch/queue";
import type { BatchStore } from "@/lib/batch/store";
import CdCover from "./CdCover";
import { Icon, Spinner } from "./ui";

const BarcodeScanner = dynamic(() => import("./BarcodeScanner"), { ssr: false });

type Last = { id: string; duplicate: boolean } | { invalid: string };

/**
 * "Scan a stack", one CD at a time: after each scan the camera closes and a
 * card shows the CD found, with "Next CD" (scan the next one), "Try again"
 * (drop this scan and rescan) and "Done".
 */
export default function StackScan({
  store,
  items,
  autoStart = false,
  hint,
  renderItem,
}: {
  store: BatchStore;
  items: BatchItem[];
  /** Opens the scanner straight away (e.g. ?scan=1 from the Scan tab). */
  autoStart?: boolean;
  /** Shown on the card under the CD, e.g. what to do next. */
  hint?: string;
  /** Extra steps for the CD just scanned, shown on the card (e.g. photos and grades on the Auto tab). */
  renderItem?: (item: BatchItem) => ReactNode;
}) {
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  function handle(raw: string) {
    setScanning(false);
    const gtin = normalizeGtin(raw);
    if (!gtin) {
      setLast({ invalid: raw });
      return;
    }
    const result = store.add(gtin);
    if ("duplicate" in result) {
      setLast({ id: result.duplicate.id, duplicate: true });
    } else {
      setLast({ id: result.added.id, duplicate: false });
      setCount((n) => n + 1);
    }
  }

  async function scanOnce() {
    setError(null);
    if (!isNativeApp()) {
      setScanning(true);
      return;
    }
    try {
      const code = await scanBarcode();
      if (code) handle(code);
    } catch (err) {
      setError(`Scanner error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Drops the CD just scanned (if it was new) and opens the scanner again. */
  function tryAgain() {
    if (last && "id" in last && !last.duplicate) {
      store.remove(last.id);
      setCount((n) => Math.max(0, n - 1));
    }
    setLast(null);
    scanOnce();
  }

  const started = useRef(false);
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      scanOnce();
    }
    // Only on the first render with autoStart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => {
    if (last) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [last]);

  const item = last && "id" in last ? items.find((x) => x.id === last.id) : undefined;
  const loading = item && (item.lookup === "queued" || item.lookup === "loading");

  return (
    <>
      {!last && (
        <button type="button" onClick={() => { setCount(0); scanOnce(); }} className="btn btn-primary btn-lg w-full">
          <Icon name="stack" size={22} strokeWidth={1.8} />
          Scan a stack
        </button>
      )}
      {error && (
        <p role="alert" className="notice notice-bad fade-in">
          {error}
        </p>
      )}

      {last && (
        <div ref={cardRef} className="card flex scroll-mt-20 flex-col gap-3 fade-in" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Scanned CD</span>
            {count > 0 && <span className="t-small text-muted tabular-nums">{count} this stack</span>}
          </div>
          {"invalid" in last ? (
            <p className="notice notice-bad">That code ({last.invalid}) isn&apos;t a product barcode. Try again.</p>
          ) : item ? (
            <div className="flex items-center gap-3">
              <CdCover item={item} />
              <div className="min-w-0 flex-1">
                <p className="t-headline truncate">{loading && !item.title ? "Finding the album…" : batchItemName(item)}</p>
                <p className="t-small truncate text-muted">
                  {item.lookup === "error"
                    ? `Not found: ${item.barcode}`
                    : [item.artist, item.year].filter(Boolean).join(" · ") || item.barcode}
                </p>
                <p className={`t-small font-medium ${last.duplicate ? "text-warn-ink" : "text-ok-ink"}`}>
                  {last.duplicate ? "Already on the list" : "Added to the list"}
                </p>
              </div>
              {loading && <Spinner className="text-brand-ink" />}
            </div>
          ) : (
            <p className="t-small text-muted">Removed from the list.</p>
          )}
          {hint && item && "id" in last && !last.duplicate && <p className="t-small text-muted">{hint}</p>}
          {item && renderItem?.(item)}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary btn-lg" onClick={tryAgain}>
              Try again
            </button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => { setLast(null); scanOnce(); }}>
              Next CD
              <Icon name="arrow" />
            </button>
          </div>
          <button type="button" className="link t-small self-center px-2 py-1" onClick={() => setLast(null)}>
            Done scanning
          </button>
        </div>
      )}

      {scanning && <BarcodeScanner onDetected={handle} onClose={() => setScanning(false)} />}
    </>
  );
}
