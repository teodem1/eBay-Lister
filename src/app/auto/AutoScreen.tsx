"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { normalizeGtin } from "@/lib/identify/barcode";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import CdCover from "@/components/CdCover";
import StackScan from "@/components/StackScan";
import { conditionComplete, conditionTitleSuffix } from "@/lib/listing/condition";
import { batchItemName, type BatchItem } from "@/lib/batch/queue";
import { autoStore, batchStore, useAuto } from "@/lib/batch/store";
import { useBackgroundLookups } from "@/lib/batch/useBackgroundLookups";
import {
  autoState,
  autoSummary,
  BUSY_STAGES,
  missingForAuto,
  rescanned,
  retryByRescan,
  stageLabel,
  toListEntry,
} from "@/lib/auto/auto";
import { useAutoRun } from "./useAutoRun";
import AutoCdSteps from "./AutoCdSteps";

const noop = () => () => {};

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

/**
 * "Auto": scan a stack; after each barcode take the front and back cover
 * photos and grade the disc and inlay. The app then checks sold prices (one
 * sold-comps call per CD), Claude writes the listing and picks the price, and
 * it is published with no review screen. Published CDs go to the Review tab.
 */
export default function AutoScreen() {
  const items = useAuto();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanCardId, setScanCardId] = useState<string | null>(null);
  // A failed CD whose barcode is being scanned again (browser scanner open).
  const [rescanId, setRescanId] = useState<string | null>(null);
  const [rescanError, setRescanError] = useState<string | null>(null);
  // CDs the seller is still working on (on the scan card, or opened in the list) wait until they move on.
  const held = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    held.current = new Set([scanCardId, openId, rescanId].filter((x): x is string => !!x));
  }, [scanCardId, openId, rescanId]);

  /** Puts the rescanned barcode on the CD: the album is looked up again and the CD is listed as usual. */
  function applyRescan(id: string, raw: string) {
    setRescanId(null);
    const gtin = normalizeGtin(raw);
    if (!gtin) {
      setRescanError(`That code (${raw}) isn't a product barcode. Tap Try again to scan it again.`);
      return;
    }
    autoStore.update(id, (x) => rescanned(x, gtin));
  }

  /** "Try again" on a CD that found nothing: scan its barcode again (often misread the first time). */
  async function rescan(id: string) {
    setRescanError(null);
    if (!isNativeApp()) {
      setRescanId(id);
      return;
    }
    try {
      const code = await scanBarcode();
      if (code) applyRescan(id, code);
    } catch (err) {
      setRescanError(`Scanner error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const run = useAutoRun(hydrated, held);

  useBackgroundLookups(autoStore, items, hydrated);

  const pending = items.filter((x) => x.status === "pending");
  const summary = autoSummary(items);
  const readyNow = summary.ready - [scanCardId, openId].filter((id) => id && pending.some((x) => x.id === id && !missingForAuto(x) && autoState(x).stage === "waiting")).length;
  const left = summary.running + Math.max(0, readyNow);

  // Listing runs in the background: a CD starts as soon as it's complete and the seller has moved on to the next one.
  const { running, paused, start } = run;
  useEffect(() => {
    if (hydrated && !running && !paused && readyNow > 0) start();
  }, [hydrated, running, paused, readyNow, start]);

  return (
    <>
      <AppBar title="Auto" />
      <main className={`page page-tabs ${running || paused ? "pb-40" : ""}`}>
        <header className="pt-1">
          <h1 className="t-display">Auto list</h1>
          <p className="mt-1 text-muted">
            Scan each CD, take the front and back cover (and any extra) photos and grade it. While you scan the next
            one, Claude writes the listing, picks the price from sold copies and publishes it. Check and edit the
            results in Review.
          </p>
        </header>

        <StackScan
          store={autoStore}
          items={items}
          renderItem={(item) => <AutoCdSteps key={item.id} item={item} startCamera />}
          onCurrent={setScanCardId}
          hint="It's listed in the background as soon as you tap Next CD or Done scanning."
          notFoundHint="If the number is right, take the cover photos anyway: Claude reads the album off the front cover."
        />

        {!hydrated ? (
          <div className="skeleton h-32" />
        ) : (
          <>
            {pending.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="To auto list">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="t-headline">{pending.length} to list</h2>
                  <span className="t-small text-muted">{summary.ready} ready</span>
                </div>
                <ul className="card divide-y divide-line overflow-hidden p-0">
                  {pending.map((item) => (
                    <AutoRow
                      key={item.id}
                      item={item}
                      open={openId === item.id}
                      onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                      onRetry={() => {
                        if (retryByRescan(item)) {
                          rescan(item.id);
                          return;
                        }
                        // The error stays until the run starts, so a repeat of the same failure can say so.
                        autoStore.update(item.id, (x) => ({ ...x, auto: { ...autoState(x), stage: "waiting" } }));
                        run.start(item.id);
                      }}
                    />
                  ))}
                </ul>
                {rescanError && (
                  <p role="alert" className="notice notice-bad">
                    {rescanError}
                  </p>
                )}
                <p className="t-small flex gap-2 px-1 text-muted">
                  <Icon name="alert" size={16} className="mt-0.5" />
                  <span>
                    Each CD uses one sold-price check (of 100 a month), even if it has to be tried again. A CD whose
                    barcode names no album is named from its front cover and checked once more by name. Shipping, Best
                    Offer and the 11% promotion come from your usual settings.
                  </span>
                </p>
              </section>
            )}

            {summary.published > 0 && (
              <Link href="/review" className="card flex items-center gap-3 p-4">
                <Icon name="check" className="text-ok-ink" />
                <span className="flex-1 font-medium">
                  {summary.published} published. Check and edit them in Review.
                </span>
                <Icon name="arrow" className="text-muted" />
              </Link>
            )}

            {pending.length === 0 && summary.published === 0 && (
              <section className="card flex flex-col items-center gap-2 py-8 text-center">
                <Icon name="bolt" size={36} strokeWidth={1.5} className="text-subtle" />
                <p className="t-title">Nothing to list</p>
                <p className="t-small max-w-xs text-muted">
                  Tap Scan a stack. After each barcode, take the front and back cover photos and grade the CD, then tap
                  Next CD.
                </p>
              </section>
            )}
          </>
        )}
      </main>

      {hydrated && (running || (paused && readyNow > 0)) && (
        <div className="fixed inset-x-0 bottom-20 z-20 border-t border-line/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
            {running ? (
              <>
                <Spinner className="text-brand-ink" />
                <div className="min-w-0 flex-1">
                  <p className="t-small font-semibold">Listing in the background · {left} to go</p>
                  <p className="t-caption text-muted">Keep the app open. {summary.published} published so far.</p>
                </div>
                <button type="button" className="btn btn-secondary min-h-10 px-3 text-sm" onClick={run.pause}>
                  Pause
                </button>
              </>
            ) : (
              <>
                <p className="t-small min-w-0 flex-1 font-medium">Paused · {readyNow} ready to list</p>
                <button type="button" className="btn btn-primary min-h-10 px-4 text-sm" onClick={() => start()}>
                  <Icon name="bolt" size={18} /> Resume
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {rescanId && (
        <BarcodeScanner onDetected={(code) => applyRescan(rescanId, code)} onClose={() => setRescanId(null)} />
      )}
      <TabBar active="auto" />
    </>
  );
}

/** One CD waiting to be listed: its photos and grades; shows its progress during the run. */
function AutoRow({ item, open, onToggle, onRetry }: { item: BatchItem; open: boolean; onToggle: () => void; onRetry: () => void }) {
  const a = autoState(item);
  const missing = missingForAuto(item);
  const busy = BUSY_STAGES.includes(a.stage);
  const loading = item.lookup === "queued" || item.lookup === "loading";
  const locked = busy || a.stage === "published";
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const cond = item.condition ?? {};
  const status = busy
    ? stageLabel(a.stage)
    : a.stage === "failed"
      ? "Not listed"
      : (missing ?? "Ready");
  const tone = a.stage === "failed" ? "text-bad-ink" : missing ? "text-muted" : "text-ok-ink";

  return (
    <li ref={rowRef} className="scroll-mt-20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        disabled={locked}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-surface-2"
      >
        <CdCover item={item} src={a.photos[0] ?? item.coverUrl} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-semibold">{loading && !item.title ? "Finding the album…" : batchItemName(item)}</p>
          <p className="t-small truncate text-muted">
            {conditionComplete(cond) ? conditionTitleSuffix(cond).replace(/^\(|\)$/g, "") : item.artist || item.barcode}
          </p>
          <p className={`t-small font-medium ${tone}`}>{status}</p>
        </div>
        {loading || busy ? (
          <Spinner className="text-brand-ink" />
        ) : (
          <Icon name="chevron" className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {a.stage === "failed" && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <p className="notice notice-bad t-small">{a.error ?? "Something went wrong."}</p>
          {a.sameAgain && a.failedAt && (
            <p className="t-caption px-1 text-muted">
              Checked again at {new Date(a.failedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {a.tries ? ` (${a.tries} tries)` : ""}: same result.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={onRetry}>
              Try again
            </button>
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => {
                batchStore.put(toListEntry(item));
                autoStore.remove(item.id);
              }}
            >
              List by hand
            </button>
          </div>
        </div>
      )}

      {open && !locked && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2/40 p-3 fade-in">
          {item.lookup === "error" && (
            <div className="notice notice-warn flex items-center gap-3">
              <span className="flex-1">{item.error ?? "Couldn't find this barcode."}</span>
              <button type="button" className="link px-1 py-1" onClick={() => autoStore.update(item.id, { lookup: "queued", error: undefined })}>
                Try again
              </button>
            </div>
          )}
          <AutoCdSteps item={item} />

          <button type="button" className="btn btn-secondary" onClick={() => autoStore.remove(item.id)}>
            Remove from the list
          </button>
        </div>
      )}
    </li>
  );
}

