"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import CdCover from "@/components/CdCover";
import StackScan from "@/components/StackScan";
import { conditionComplete, conditionTitleSuffix } from "@/lib/listing/condition";
import { batchItemName, type BatchItem } from "@/lib/batch/queue";
import { autoStore, batchStore, useAuto } from "@/lib/batch/store";
import { useBackgroundLookups } from "@/lib/batch/useBackgroundLookups";
import { autoState, autoSummary, missingForAuto, stageLabel, toListEntry } from "@/lib/auto/auto";
import { useAutoRun } from "./useAutoRun";
import AutoCdSteps from "./AutoCdSteps";

const noop = () => () => {};

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
  const run = useAutoRun(hydrated);

  useBackgroundLookups(autoStore, items, hydrated);

  const pending = items.filter((x) => x.status === "pending");
  const summary = autoSummary(items);

  // Once the open CD has its photos and grades, fold it away.
  const open = pending.find((x) => x.id === openId);
  const openDone = open ? !missingForAuto(open) : false;
  useEffect(() => {
    if (!openDone) return;
    const t = setTimeout(() => setOpenId(null), 700);
    return () => clearTimeout(t);
  }, [openDone]);

  return (
    <>
      <AppBar title="Auto" />
      <main className={`page page-tabs ${summary.ready || run.running ? "pb-44" : ""}`}>
        <header className="pt-1">
          <h1 className="t-display">Auto list</h1>
          <p className="mt-1 text-muted">
            Scan each CD, take the front and back cover photos and grade it. Claude then writes the listing, picks the
            price from sold copies and publishes it. Check and edit the results in Review.
          </p>
        </header>

        <StackScan
          store={autoStore}
          items={items}
          renderItem={(item) => <AutoCdSteps key={item.id} item={item} startCamera />}
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
                        autoStore.update(item.id, (x) => ({ ...x, auto: { ...autoState(x), stage: "waiting", error: undefined } }));
                        run.start(item.id);
                      }}
                    />
                  ))}
                </ul>
                <p className="t-small flex gap-2 px-1 text-muted">
                  <Icon name="alert" size={16} className="mt-0.5" />
                  <span>
                    Each CD uses one sold-price check (of 100 a month), even if it has to be tried again. Shipping, Best
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

      {hydrated && (summary.ready > 0 || run.running) && (
        <div className="fixed inset-x-0 bottom-20 z-20 border-t border-line/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-lg flex-col gap-1 px-4 py-3">
            {run.running ? (
              <>
                <button type="button" className="btn btn-secondary btn-lg w-full" onClick={run.pause}>
                  <Spinner /> Listing… tap to stop after these
                </button>
                <p className="t-caption text-center text-muted">Keep this screen open until it finishes.</p>
              </>
            ) : (
              <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => run.start()}>
                <Icon name="bolt" size={22} strokeWidth={1.9} />
                Auto list {summary.ready} {summary.ready === 1 ? "CD" : "CDs"}
              </button>
            )}
          </div>
        </div>
      )}
      <TabBar active="auto" />
    </>
  );
}

/** One CD waiting to be listed: its photos and grades; shows its progress during the run. */
function AutoRow({ item, open, onToggle, onRetry }: { item: BatchItem; open: boolean; onToggle: () => void; onRetry: () => void }) {
  const a = autoState(item);
  const missing = missingForAuto(item);
  const busy = a.stage === "pricing" || a.stage === "writing" || a.stage === "publishing";
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

