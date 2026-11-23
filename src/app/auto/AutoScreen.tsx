"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import CdCover from "@/components/CdCover";
import ConditionPicker, { type ConditionDraft } from "@/app/listing/ConditionPicker";
import CdCamera from "@/app/listing/CdCamera";
import { uploadPhoto } from "@/app/listing/PhotoPicker";
import { formatMoney } from "@/app/listing/priceRequest";
import { normalizeGtin } from "@/lib/identify/barcode";
import { scanBarcode } from "@/lib/native/barcode";
import { isCancel, takeItemPhoto } from "@/lib/native/camera";
import { isNativeApp } from "@/lib/native/platform";
import { conditionComplete, conditionTitleSuffix } from "@/lib/listing/condition";
import { batchItemName, type BatchItem } from "@/lib/batch/queue";
import { autoStore, batchStore, useAuto } from "@/lib/batch/store";
import { useBackgroundLookups } from "@/lib/batch/useBackgroundLookups";
import { AUTO_MAX_PHOTOS, autoState, autoSummary, missingForAuto, stageLabel, toListEntry } from "@/lib/auto/auto";
import { useAutoRun } from "./useAutoRun";
import EditPublishedSheet from "./EditPublishedSheet";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });
const noop = () => () => {};

/**
 * "Auto": scan a stack, grade each CD and take one photo; the app then prices
 * (sold-comps, one check per CD), writes (Claude) and publishes each one with
 * no review screen. Published CDs show below so the seller can judge the
 * results and edit the live listing.
 */
export default function AutoScreen() {
  const items = useAuto();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scannedNow, setScannedNow] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const run = useAutoRun(hydrated);

  useBackgroundLookups(autoStore, items, hydrated);

  const pending = items.filter((x) => x.status === "pending");
  const published = items.filter((x) => autoState(x).stage === "published");
  const summary = autoSummary(items);
  const firstIncomplete = pending.find((x) => missingForAuto(x) && autoState(x).stage === "waiting");
  const shownOpen = openId ?? null;

  function addCode(raw: string): string | null {
    const gtin = normalizeGtin(raw);
    if (!gtin) {
      setMessage({ tone: "bad", text: `That code (${raw}) isn't a product barcode.` });
      return null;
    }
    const result = autoStore.add(gtin);
    if ("duplicate" in result) {
      const text = `Already on the list: ${batchItemName(result.duplicate)}`;
      setLastScan(text);
      return text;
    }
    setScannedNow((n) => n + 1);
    setMessage(null);
    const text = `Added ${gtin}`;
    setLastScan(text);
    return text;
  }

  async function startScan() {
    setScannedNow(0);
    setLastScan(null);
    if (!isNativeApp()) {
      setScanning(true);
      return;
    }
    try {
      let added = 0;
      for (;;) {
        const code = await scanBarcode();
        if (!code) break;
        if (addCode(code)?.startsWith("Added")) added++;
      }
      if (added) setMessage({ tone: "ok", text: `Added ${added} ${added === 1 ? "CD" : "CDs"}. Grade each one and take a photo.` });
    } catch (err) {
      setMessage({ tone: "bad", text: `Scanner error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function closeScanner() {
    setScanning(false);
    if (scannedNow) setMessage({ tone: "ok", text: `Added ${scannedNow} ${scannedNow === 1 ? "CD" : "CDs"}. Grade each one and take a photo.` });
  }

  // Once the open CD is graded and photographed, move on to the next one that isn't.
  const open = pending.find((x) => x.id === shownOpen);
  const openDone = open ? !missingForAuto(open) : false;
  useEffect(() => {
    if (!openDone) return;
    const t = setTimeout(() => setOpenId(firstIncomplete?.id ?? null), 700);
    return () => clearTimeout(t);
  }, [openDone, firstIncomplete?.id]);

  const editItem = items.find((x) => x.id === editing);

  return (
    <>
      <AppBar title="Auto" />
      <main className={`page page-tabs ${summary.ready ? "pb-44" : ""}`}>
        <header className="pt-1">
          <h1 className="t-display">Auto list</h1>
          <p className="mt-1 text-muted">
            Scan a stack, grade each CD and take one photo. The app sets the price from sold copies, writes the
            listing and publishes it, with no review step. Check the results below.
          </p>
        </header>

        <button type="button" onClick={startScan} className="btn btn-primary btn-lg w-full">
          <Icon name="stack" size={22} strokeWidth={1.8} />
          Scan a stack
        </button>
        {message && (
          <p role={message.tone === "bad" ? "alert" : "status"} className={`notice fade-in ${message.tone === "bad" ? "notice-bad" : "notice-ok"}`}>
            {message.text}
          </p>
        )}

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
                      open={shownOpen === item.id}
                      onToggle={() => setOpenId(shownOpen === item.id ? null : item.id)}
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

            {pending.length === 0 && published.length === 0 && (
              <section className="card flex flex-col items-center gap-2 py-8 text-center">
                <Icon name="bolt" size={36} strokeWidth={1.5} className="text-subtle" />
                <p className="t-title">Nothing to list</p>
                <p className="t-small max-w-xs text-muted">
                  Scan a stack of CDs. For each one pick the disc and inlay grade and take a photo, then tap Auto list.
                </p>
              </section>
            )}

            {published.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Published">
                <div className="flex items-center justify-between px-1">
                  <h2 className="t-headline">Published ({published.length})</h2>
                  <button
                    type="button"
                    className="link t-small px-1 py-1"
                    onClick={() => autoStore.replace(autoStore.all().filter((x) => autoState(x).stage !== "published"))}
                  >
                    Clear
                  </button>
                </div>
                <p className="t-small px-1 text-muted">Tap Edit to change a listing. Changes go straight to the live listing on eBay.</p>
                <ul className="flex flex-col gap-2">
                  {published.map((item) => (
                    <ResultCard key={item.id} item={item} onEdit={() => setEditing(item.id)} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {scanning && (
          <BarcodeScanner continuous status={`${scannedNow} added${lastScan ? ` · ${lastScan}` : ""}`} onDetected={addCode} onClose={closeScanner} />
        )}
        {editItem && <EditPublishedSheet item={editItem} onClose={() => setEditing(null)} />}
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

/** One CD waiting to be listed: grade it and take its photo; shows its progress during the run. */
function AutoRow({ item, open, onToggle, onRetry }: { item: BatchItem; open: boolean; onToggle: () => void; onRetry: () => void }) {
  const a = autoState(item);
  const missing = missingForAuto(item);
  const busy = a.stage === "pricing" || a.stage === "writing" || a.stage === "publishing";
  const loading = item.lookup === "queued" || item.lookup === "loading";
  const locked = busy || a.stage === "published";
  const rowRef = useRef<HTMLLIElement>(null);
  const [camera, setCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (open) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  function setCond(next: ConditionDraft) {
    autoStore.update(item.id, { condition: next });
  }

  async function addPhoto(file: File) {
    setPhotoError(null);
    setUploading(true);
    try {
      const url = await uploadPhoto(file);
      autoStore.update(item.id, (x) => {
        const s = autoState(x);
        return { ...x, auto: { ...s, photos: [...s.photos, url].slice(0, AUTO_MAX_PHOTOS) } };
      });
    } catch (e) {
      setPhotoError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function systemCamera() {
    try {
      const file = await takeItemPhoto();
      if (file) await addPhoto(file);
    } catch (e) {
      if (!isCancel(e)) setPhotoError((e as Error).message);
    }
  }

  function removePhoto(url: string) {
    autoStore.update(item.id, (x) => {
      const s = autoState(x);
      return { ...x, auto: { ...s, photos: s.photos.filter((p) => p !== url) } };
    });
  }

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
          <ConditionPicker compact value={cond} onChange={setCond} />

          <div className="card space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="t-headline">Photo</span>
              <span className="t-small text-muted">eBay needs one real photo</span>
            </div>
            {(a.photos.length > 0 || uploading) && (
              <ul className="grid grid-cols-4 gap-2">
                {a.photos.map((u, i) => (
                  <li key={u} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo */}
                    <img src={u} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="icon-btn absolute right-0.5 top-0.5 h-8 w-8 bg-surface/90"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => removePhoto(u)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
                {uploading && (
                  <li className="skeleton flex aspect-square items-center justify-center rounded-lg">
                    <Spinner />
                  </li>
                )}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-secondary h-14 w-full"
              disabled={uploading || a.photos.length >= AUTO_MAX_PHOTOS}
              onClick={() => setCamera(true)}
            >
              <Icon name="camera" size={22} strokeWidth={1.8} />
              {a.photos.length ? "Add another photo" : "Take photo"}
            </button>
            {photoError && (
              <p role="alert" className="notice notice-bad">
                {photoError}
              </p>
            )}
          </div>

          <button type="button" className="btn btn-secondary" onClick={() => autoStore.remove(item.id)}>
            Remove from the list
          </button>
          {camera && (
            <CdCamera
              onShot={(file) => {
                // One photo is enough here: close right after the shot.
                setCamera(false);
                addPhoto(file);
              }}
              onClose={() => setCamera(false)}
              onUnavailable={() => {
                setCamera(false);
                systemCamera();
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** A published CD: photo, title, price and how it was picked, with Edit and a link to eBay. */
function ResultCard({ item, onEdit }: { item: BatchItem; onEdit: () => void }) {
  const a = autoState(item);
  const d = a.draft;
  return (
    <li className="card flex flex-col gap-2 p-3">
      <div className="flex gap-3">
        <CdCover item={item} src={a.photos[0] ?? item.coverUrl} />
        <div className="min-w-0 flex-1">
          <p className="t-small font-semibold leading-snug">{d?.title ?? batchItemName(item)}</p>
          <p className="t-small mt-0.5">
            <b className="tabular-nums">{d ? formatMoney(d.price, "CAD") : ""}</b>
            {a.priceBasis && <span className="text-muted"> · {a.priceBasis}</span>}
          </p>
          <p className="t-caption mt-0.5 text-muted">
            {[
              d?.categoryName?.split(">").pop()?.trim(),
              a.promotedPercent ? `Promoted ${a.promotedPercent}%` : null,
              a.revisedAt ? "Edited" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {a.promotionError && <p className="notice notice-warn t-small">{a.promotionError}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onEdit}>
          Edit
        </button>
        {item.listingUrl && (
          <a href={item.listingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary flex-1">
            eBay <Icon name="external" size={16} />
          </a>
        )}
      </div>
    </li>
  );
}
