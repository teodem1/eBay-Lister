"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import ConditionPicker, { type ConditionDraft } from "@/app/listing/ConditionPicker";
import { normalizeGtin } from "@/lib/identify/barcode";
import { stashScanned } from "@/lib/collection/store";
import { conditionComplete, conditionParams } from "@/lib/listing/condition";
import {
  batchItemName,
  batchListingHref,
  nextPending,
  progressLabel,
  summarize,
  type BatchItem,
} from "@/lib/batch/queue";
import { batchStore, useBatch } from "@/lib/batch/store";
import CdCover from "@/components/CdCover";
import StackScan from "@/components/StackScan";
import { useBackgroundLookups } from "@/lib/batch/useBackgroundLookups";


const noop = () => () => {};
const MONTHLY_PRICE_CHECKS = 100;

/**
 * "To list": CDs scanned but not listed yet, saved on the phone. Scan a stack
 * in a row (names load in the background), then grade and list them one by one.
 */
export default function ToListScreen() {
  const items = useBatch();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const router = useRouter();
  const params = useSearchParams();
  // ?scan=1 (from the Scan screen) opens the scanner straight away.
  const [autoScan] = useState(() => !!params.get("scan"));
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  // undefined until the seller taps a row; after a publish (?next=1) the next CD starts open.
  const [tapped, setTapped] = useState<string | null | undefined>(undefined);
  const [wantNext] = useState(() => !!params.get("next"));

  const pending = items.filter((x) => x.status === "pending");
  const done = items.filter((x) => x.status !== "pending");
  const summary = summarize(items);
  const openId = tapped !== undefined ? tapped : wantNext ? (nextPending(items)?.id ?? null) : null;

  // ?scan=1 (from the Scan screen) opens the scanner; ?next=1 (after a publish) opens the next CD.
  const handledParams = useRef(false);
  useEffect(() => {
    if (!hydrated || handledParams.current) return;
    handledParams.current = true;
    if (params.get("scan") || params.get("next")) router.replace("/to-list");
    // Runs once, after the list is read from the device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useBackgroundLookups(batchStore, items, hydrated);

  /** A barcode typed by hand. */
  function addCode(raw: string): boolean {
    const gtin = normalizeGtin(raw);
    if (!gtin) {
      setMessage({ tone: "bad", text: `That code (${raw}) isn't a product barcode.` });
      return false;
    }
    const result = batchStore.add(gtin);
    setMessage(
      "duplicate" in result
        ? { tone: "ok", text: `Already on the list: ${batchItemName(result.duplicate)}` }
        : { tone: "ok", text: `Added ${gtin}` },
    );
    return true;
  }

  const manualValid = normalizeGtin(manualCode) !== null;

  return (
    <>
      <AppBar title="To list" />
      <main className="page page-tabs">
        <header className="pt-1">
          <h1 className="t-display">To list</h1>
          <p className="mt-1 text-muted">CDs you scanned but haven&apos;t listed yet. They stay saved on this phone.</p>
        </header>

        <section className="flex flex-col gap-3" aria-label="Add CDs">
          <StackScan store={batchStore} items={items} autoStart={autoScan} />
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualValid && addCode(manualCode)) setManualCode("");
            }}
          >
            <label htmlFor="queue-code" className="sr-only">
              Barcode number
            </label>
            <input
              id="queue-code"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Type a barcode to add"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="field h-14 pl-4 pr-14"
            />
            <button
              type="submit"
              disabled={!manualValid}
              aria-label="Add barcode"
              className="btn btn-primary absolute right-1 top-1 h-12 min-h-12 w-12 rounded-[0.625rem] px-0"
            >
              <Icon name="plus" size={20} />
            </button>
          </form>
          {message && (
            <p role={message.tone === "bad" ? "alert" : "status"} className={`notice fade-in ${message.tone === "bad" ? "notice-bad" : "notice-ok"}`}>
              {message.text}
            </p>
          )}
        </section>

        {!hydrated ? (
          <div className="skeleton h-32" />
        ) : (
          <>
            {items.length > 0 && <PriceCheckNote used={summary.priceChecks} pending={summary.pending} />}

            {pending.length === 0 ? (
              <EmptyState anyDone={done.length > 0} />
            ) : (
              <section className="flex flex-col gap-2" aria-label="Waiting to be listed">
                <h2 className="t-headline px-1">
                  {pending.length} waiting
                </h2>
                <ul className="card divide-y divide-line overflow-hidden p-0">
                  {pending.map((item) => (
                    <QueueRow
                      key={item.id}
                      item={item}
                      open={openId === item.id}
                      onToggle={() => setTapped(openId === item.id ? null : item.id)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {done.length > 0 && <DoneList items={done} />}
          </>
        )}

      </main>
      <TabBar active="tolist" />
    </>
  );
}

function PriceCheckNote({ used, pending }: { used: number; pending: number }) {
  return (
    <p className="t-small flex gap-2 px-1 text-muted">
      <Icon name="alert" size={16} className="mt-0.5" />
      <span>
        Names load now for free. The sold-price check runs when you open a CD, one of your {MONTHLY_PRICE_CHECKS} a
        month. This list has used <b className="text-foreground">{used}</b>
        {pending > 0 && <>; listing the rest uses up to {pending} more</>}.
      </span>
    </p>
  );
}

function QueueRow({ item, open, onToggle }: { item: BatchItem; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [cond, setCond] = useState<ConditionDraft>(item.progress?.condition ?? item.condition ?? {});
  const progress = progressLabel(item);
  const resumable = !!item.progress;
  const loading = item.lookup === "queued" || item.lookup === "loading";
  const rowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (open) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  function openListing() {
    // Hands the cover and album details to the listing screen for the Collection.
    stashScanned(item.scanned ? { ...item.scanned, query: item.query } : null);
    if (!resumable) batchStore.update(item.id, { condition: cond });
    router.push(batchListingHref(item, resumable ? {} : conditionParams(cond)));
  }

  return (
    <li ref={rowRef} className="scroll-mt-20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-surface-2"
      >
        <CdCover item={item} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-semibold">{loading && !item.title ? "Finding the album…" : batchItemName(item)}</p>
          <p className="t-small truncate text-muted">
            {item.lookup === "error"
              ? `Not found: ${item.barcode}`
              : [item.artist, item.year].filter(Boolean).join(" · ") || item.barcode || "From a photo"}
          </p>
          {progress && (
            <span className="chip mt-1 w-fit bg-brand-soft text-brand-ink">
              <Icon name="check" size={12} strokeWidth={2.6} />
              {progress}
            </span>
          )}
        </div>
        {loading ? <Spinner className="text-brand-ink" /> : <Icon name="chevron" className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2/40 p-3 fade-in">
          {item.lookup === "error" && (
            <div className="notice notice-warn flex items-center gap-3">
              <span className="flex-1">{item.error ?? "Couldn't find this barcode."}</span>
              <button type="button" className="link px-1 py-1" onClick={() => batchStore.update(item.id, { lookup: "queued", error: undefined })}>
                Try again
              </button>
            </div>
          )}
          {resumable ? (
            <p className="t-small text-muted">Your grades, photos and draft are saved. Pick up where you left off.</p>
          ) : (
            <ConditionPicker compact hint="Grade it so the price check matches copies in the same condition." value={cond} onChange={setCond} />
          )}
          <button
            type="button"
            onClick={openListing}
            disabled={loading || (!resumable && !conditionComplete(cond) && !!cond.disc)}
            className="btn btn-primary btn-lg w-full"
          >
            {resumable ? "Continue listing" : "Create listing"}
            <Icon name="arrow" />
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={() => batchStore.update(item.id, { status: "skipped", doneAt: new Date().toISOString() })}>
              Skip
            </button>
            <button type="button" className="btn btn-secondary flex-1" onClick={() => batchStore.remove(item.id)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function DoneList({ items }: { items: BatchItem[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label="Done">
      <div className="flex items-center justify-between px-1">
        <h2 className="t-headline">Done</h2>
        <button type="button" className="link t-small px-1 py-1" onClick={() => batchStore.clearDone()}>
          Clear
        </button>
      </div>
      <ul className="card divide-y divide-line overflow-hidden p-0">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 p-3">
            <CdCover item={item} small />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{batchItemName(item)}</p>
              <p className="t-small text-muted">{item.status === "listed" ? "Listed" : "Skipped"}</p>
            </div>
            {item.status === "listed" && item.listingUrl ? (
              <a href={item.listingUrl} target="_blank" rel="noreferrer" className="link t-small flex items-center gap-1 px-1 py-1">
                eBay
                <Icon name="external" size={14} />
              </a>
            ) : (
              <button type="button" className="link t-small px-1 py-1" onClick={() => batchStore.update(item.id, { status: "pending", doneAt: undefined })}>
                Put back
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({ anyDone }: { anyDone: boolean }) {
  return (
    <section className="card flex flex-col items-center gap-2 py-8 text-center">
      <Icon name="stack" size={36} strokeWidth={1.5} className="text-subtle" />
      <p className="t-title">{anyDone ? "All listed" : "Nothing waiting"}</p>
      <p className="t-small max-w-xs text-muted">
        {anyDone
          ? "Every CD on the list is done. Scan another stack, or a single CD from the Scan tab."
          : "Scan a stack of CDs in a row, then list them one at a time. A CD you start on the Scan tab shows here too until it's listed."}
      </p>
      {anyDone && (
        <Link href="/" className="link t-small mt-1 px-1 py-1">
          Go to Scan
        </Link>
      )}
    </section>
  );
}
