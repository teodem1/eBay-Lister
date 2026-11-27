"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resizeImage } from "@/lib/resize-image";
import { normalizeGtin } from "@/lib/identify/barcode";
import { listingQuery, type LookupError, type LookupResponse } from "@/lib/lookup";
import { takeItemPhoto } from "@/lib/native/camera";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";
import { itemFromLookup } from "@/lib/collection/collection";
import { stashScanned } from "@/lib/collection/store";
import { conditionParams } from "@/lib/listing/condition";
import { batchStore } from "@/lib/batch/store";
import { batchListingHref } from "@/lib/batch/queue";
import ConditionPicker, { type ConditionDraft } from "@/app/listing/ConditionPicker";
import { AppBar, Icon, Spinner, TabBar } from "./ui";

const BarcodeScanner = dynamic(() => import("./BarcodeScanner"), { ssr: false });

type Status =
  | { kind: "idle" }
  | { kind: "loading"; label: string; preview?: string }
  | { kind: "done"; data: LookupResponse; preview?: string }
  | { kind: "error"; message: string };

export default function ItemLookup() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [typing, setTyping] = useState(false);
  // Small copy of the last photo, used as the cover when nothing better is found.
  const [thumb, setThumb] = useState<string | undefined>();

  async function run(label: string, request: () => Promise<Response>, preview?: string) {
    setStatus({ kind: "loading", label, preview });
    try {
      const res = await request();
      const json = (await res.json()) as LookupResponse | LookupError;
      if (!res.ok || "error" in json) {
        setStatus({ kind: "error", message: "error" in json ? json.error : `Error ${res.status}` });
        return;
      }
      setStatus({ kind: "done", data: json, preview });
    } catch {
      setStatus({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }

  function lookupBarcode(code: string) {
    setScanning(false);
    setThumb(undefined);
    run(`Looking up barcode ${code}…`, () =>
      fetch("/api/lookup/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    );
  }

  /**
   * Android app: Google's ML Kit scanner. Browser: the live camera scanner
   * below, which reads codes continuously (better than the photo-based web
   * fallback in scanBarcode()).
   */
  async function startScan() {
    if (!isNativeApp()) {
      setScanning(true);
      return;
    }
    try {
      const code = await scanBarcode();
      if (!code) return; // cancelled or nothing read
      const gtin = normalizeGtin(code);
      if (gtin) {
        lookupBarcode(gtin);
      } else {
        setStatus({ kind: "error", message: `That code (${code}) isn't a product barcode. Try the UPC/EAN on the box.` });
      }
    } catch (err) {
      setStatus({ kind: "error", message: `Scanner error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Android app: native camera. Browser: the phone camera via a file input. */
  async function startPhoto() {
    let file: File | null;
    try {
      file = await takeItemPhoto();
    } catch (err) {
      setStatus({ kind: "error", message: `Camera error: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (file) await onPhoto(file);
  }

  async function onPhoto(file: File) {
    const preview = URL.createObjectURL(file);
    setStatus({ kind: "loading", label: "Preparing photo…", preview });
    let blob: Blob;
    try {
      blob = await resizeImage(file);
    } catch {
      setStatus({ kind: "error", message: "Couldn't read that photo. Try another one." });
      return;
    }
    const form = new FormData();
    form.append("image", blob, "photo.jpg");
    setThumb(undefined);
    thumbnailDataUrl(file).then(setThumb);
    run("Identifying the item…", () => fetch("/api/lookup/photo", { method: "POST", body: form }), preview);
  }

  const busy = status.kind === "loading";
  const manualValid = normalizeGtin(manualCode) !== null;

  return (
    <>
      <AppBar title="Scan" subtitle="Scan or snap a CD. We find it and check what it sells for." />
      <main className="page page-tabs pt-3">
        <section className="flex flex-col gap-3" aria-label="Find the item">
          <button type="button" disabled={busy} onClick={startScan} className="btn btn-primary btn-lg w-full">
            <Icon name="scan" size={24} strokeWidth={1.8} />
            Scan barcode
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={startPhoto} className="btn btn-secondary px-3">
              <Icon name="camera" size={20} strokeWidth={1.8} />
              Take photo
            </button>
            <button
              type="button"
              disabled={busy}
              aria-expanded={typing}
              onClick={() => setTyping((t) => !t)}
              className="btn btn-secondary px-3"
            >
              <Icon name="keyboard" size={20} strokeWidth={1.8} />
              Type barcode
            </button>
          </div>

          {typing && (
            <form
              className="relative fade-in"
              onSubmit={(e) => {
                e.preventDefault();
                if (manualValid) lookupBarcode(manualCode);
              }}
            >
              <label htmlFor="manual-code" className="sr-only">
                Barcode number
              </label>
              <input
                id="manual-code"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="Type a barcode"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="field h-14 pl-4 pr-14"
              />
              <button
                type="submit"
                disabled={!manualValid || busy}
                aria-label="Search barcode"
                className="btn btn-primary absolute right-1 top-1 h-12 min-h-12 w-12 rounded-[0.625rem] px-0"
              >
                <Icon name="search" size={20} />
              </button>
            </form>
          )}

          <div className="-my-1 flex flex-wrap justify-center gap-x-4">
            <Link href="/to-list?scan=1" className="btn-link">
              <Icon name="list" size={16} />
              Scan a stack
            </Link>
            <Link href="/sort" className="btn-link">
              <Icon name="layers" size={16} />
              Sort a pile
            </Link>
          </div>
        </section>

        {status.kind === "loading" && <LoadingResults label={status.label} preview={status.preview} />}

        {status.kind === "error" && (
          <p role="alert" className="notice notice-bad fade-in flex gap-2.5">
            <Icon name="alert" className="mt-0.5" />
            {status.message}
          </p>
        )}

        {status.kind === "done" && <Results data={status.data} preview={status.preview} thumb={thumb} />}

        {scanning && <BarcodeScanner onDetected={lookupBarcode} onClose={() => setScanning(false)} />}
      </main>
      <TabBar active="scan" />
    </>
  );
}

/** ~200px JPEG data URL of the photo, small enough to keep in local storage. */
async function thumbnailDataUrl(file: File): Promise<string | undefined> {
  try {
    const blob = await resizeImage(file, 200, 0.7);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function LoadingResults({ label, preview }: { label: string; preview?: string }) {
  return (
    <section className="flex flex-col gap-3 fade-in" aria-busy>
      <div className="card flex items-center gap-3">
        {preview ? <Thumb src={preview} /> : <div className="skeleton h-16 w-16 shrink-0" />}
        <div className="flex min-w-0 flex-1 items-center gap-3 text-brand-ink">
          <Spinner />
          <span role="status" className="text-sm font-medium text-foreground">
            {label}
          </span>
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
          <div className="skeleton h-16 w-16 shrink-0" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-2/3" />
            <div className="skeleton h-3.5 w-1/3" />
          </div>
        </div>
      ))}
    </section>
  );
}

function Results({ data, preview, thumb }: { data: LookupResponse; preview?: string; thumb?: string }) {
  // Disc and inlay grades, picked here so the listing screen prices copies in the same condition.
  const [cond, setCond] = useState<ConditionDraft>({});
  const router = useRouter();
  /**
   * Hands what the scan found (cover, album details) to the listing screen,
   * which adds the CD to the Collection once the listing is reviewed. The CD
   * also goes on the To list tab, which keeps the listing's progress until it is published.
   */
  function handOff() {
    const item = itemFromLookup(data);
    const scanned = item && { ...item, coverUrl: item.coverUrl ?? thumb };
    stashScanned(scanned && { ...scanned, query: listingQuery(data) });
    const queued = batchStore.fromScan(data, cond);
    if (scanned) batchStore.update(queued.id, { scanned, coverUrl: queued.coverUrl ?? thumb });
    router.push(batchListingHref(queued, conditionParams(cond)));
  }

  const id = data.identification;
  const album = data.album;
  const cover = album?.coverUrl ?? preview ?? data.results.items[0]?.imageUrl;
  // Best name we have: the album, Claude's identification, else the top eBay match.
  const heading = album?.title ?? id?.title ?? data.results.items[0]?.title ?? `Barcode ${data.gtin}`;
  const sub = album
    ? album.artist
    : id
      ? [id.brand, id.model].filter(Boolean).join(" · ")
      : undefined;

  return (
    <section className="flex flex-col gap-4 fade-in">
      <article className="card">
        <div className="flex gap-4">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-28 w-28 shrink-0 rounded-md border border-line bg-surface-2 object-cover" />
          ) : (
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md bg-surface-2 text-subtle">
              <Icon name="disc" size={36} strokeWidth={1.5} />
            </div>
          )}
          <div className="min-w-0 flex-1 pt-1">
            {id && <p className="t-caption text-muted">We think it&apos;s</p>}
            <h2 className="t-title line-clamp-3">{heading || "Unknown item"}</h2>
            {sub && <p className="mt-1">{sub}</p>}
            {album?.year && <p className="t-small mt-0.5 tabular-nums text-muted">{album.year}</p>}
            {id?.category && <p className="t-small mt-0.5 text-muted">{id.category}</p>}
            {data.gtin && <p className="t-caption mt-2 tabular-nums text-muted">EAN {data.gtin}</p>}
            {id && <ConfidenceBadge level={id.confidence} />}
          </div>
        </div>
        {id?.conditionNotes && <p className="t-small mt-3 border-t border-line pt-3 text-muted">{id.conditionNotes}</p>}
        {data.notes.map((n) => (
          <p key={n} className="notice notice-warn mt-3">
            {n}
          </p>
        ))}
      </article>

      <ConditionPicker
        compact
        hint="Grade it now so the price check matches copies in the same condition."
        value={cond}
        onChange={setCond}
      />
      <button type="button" onClick={handOff} className="btn btn-primary btn-lg w-full">
        <Icon name="edit" size={20} strokeWidth={1.8} />
        Create listing
      </button>

      {/* Similar eBay listings are shown on the listing screen's price step, not here. */}
    </section>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-ok-soft text-ok-ink",
    medium: "bg-warn-soft text-warn-ink",
    low: "bg-bad-soft text-bad-ink",
  }[level];
  const text = { high: "Confident match", medium: "Best guess", low: "Rough guess" }[level];
  return (
    <span className={`chip mt-2 ${styles}`}>
      <Icon name={level === "high" ? "check" : "alert"} size={14} strokeWidth={2.4} />
      {text}
    </span>
  );
}

function Thumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Your photo" className="h-16 w-16 shrink-0 rounded-xl object-cover" />;
}
