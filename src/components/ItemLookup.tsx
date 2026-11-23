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
      <AppBar title="eBay Lister" />
      <main className="page page-tabs">
        <header className="pt-1">
          <h1 className="t-display">What are you selling?</h1>
          <p className="mt-1 text-muted">Scan or snap it. We find it on eBay and check what it sells for.</p>
        </header>

        <section className="flex flex-col gap-3" aria-label="Find the item">
          <button
            type="button"
            disabled={busy}
            onClick={startScan}
            className="flex min-h-24 items-center gap-4 rounded-2xl bg-brand p-4 text-left text-brand-fg shadow-lift transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-fg/10">
              <Icon name="scan" size={26} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-title block">Scan barcode</span>
              <span className="t-small block opacity-70">Fastest for CDs, games and boxed items</span>
            </span>
            <Icon name="arrow" size={20} className="opacity-60" />
          </button>

          <div className="grid grid-cols-[auto_1fr] gap-3">
            <button type="button" disabled={busy} onClick={startPhoto} className="btn btn-secondary h-14 px-5">
              <Icon name="camera" size={22} strokeWidth={1.8} />
              Photo
            </button>
            <form
              className="relative"
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
          </div>

          <Link href="/to-list?scan=1" className="btn btn-secondary h-12 w-full">
            <Icon name="stack" size={20} strokeWidth={1.8} />
            Scan a stack of CDs
          </Link>
        </section>

        {status.kind === "idle" && <HowItWorks />}

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

/** Compact how-it-works strip: three steps on one line. */
function HowItWorks() {
  const steps = ["Identify", "Price", "List"];
  return (
    <ol className="flex items-center gap-2 px-1 text-muted fade-in" aria-label="How it works">
      {steps.map((title, i) => (
        <li key={title} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-line-strong" aria-hidden />}
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-foreground">
            {i + 1}
          </span>
          <span className="t-small font-medium">{title}</span>
        </li>
      ))}
    </ol>
  );
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
        <div key={i} className="flex gap-3 rounded-2xl border border-line bg-surface p-3">
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
    ? [album.artist, album.year].filter(Boolean).join(" · ")
    : id
      ? [id.brand, id.model].filter(Boolean).join(" · ")
      : undefined;

  return (
    <section className="flex flex-col gap-4 fade-in">
      <div className="card">
        <div className="flex gap-4">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-24 w-24 shrink-0 rounded-xl border border-line bg-surface-2 object-cover" />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-subtle">
              <Icon name="disc" size={36} strokeWidth={1.5} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{id ? "We think it's" : album ? "Album found" : "Barcode match"}</p>
            <h2 className="t-title mt-0.5 line-clamp-3">{heading || "Unknown item"}</h2>
            {sub && <p className="t-small mt-0.5 text-muted">{sub}</p>}
            {id && <ConfidenceBadge level={id.confidence} />}
          </div>
        </div>
        <dl className="t-small mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3">
          {id?.category && <Row label="Category" value={id.category} />}
          {id?.conditionNotes && <Row label="Condition" value={id.conditionNotes} />}
          {album?.genres?.length ? <Row label="Genre" value={album.genres.slice(0, 3).join(", ")} /> : null}
          {data.gtin && <Row label="Barcode" value={data.gtin} />}
          {data.query && <Row label="Searched" value={`“${data.query}”`} />}
        </dl>
        {data.notes.map((n) => (
          <p key={n} className="notice notice-warn mt-3">
            {n}
          </p>
        ))}
      </div>

      <ConditionPicker
        compact
        hint="Grade it now so the suggested price matches copies in the same condition."
        value={cond}
        onChange={setCond}
      />
      <button type="button" onClick={handOff} className="btn btn-primary btn-lg w-full">
        Create listing
        <Icon name="arrow" />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </>
  );
}

function Thumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Your photo" className="h-16 w-16 shrink-0 rounded-xl object-cover" />;
}
