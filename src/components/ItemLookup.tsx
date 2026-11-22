"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { resizeImage } from "@/lib/resize-image";
import { normalizeGtin } from "@/lib/identify/barcode";
import { listingHref, type LookupError, type LookupResponse } from "@/lib/lookup";
import type { ItemSummary } from "@/lib/ebay/client";
import { takeItemPhoto } from "@/lib/native/camera";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";
import { AppBar, Spinner } from "./ui";

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
    run("Identifying the item…", () => fetch("/api/lookup/photo", { method: "POST", body: form }), preview);
  }

  const busy = status.kind === "loading";
  const manualValid = normalizeGtin(manualCode) !== null;

  return (
    <>
      <AppBar title="eBay Lister" />
      <main className="page">
        <header className="pt-2">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">What are you selling?</h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted">
            Snap the item or scan its barcode. We&apos;ll find it on eBay and check what it sells for.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={startPhoto}
            className="group relative flex h-36 flex-col justify-between overflow-hidden rounded-3xl bg-brand p-4 text-left text-brand-fg shadow-lift transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
              <CameraIcon />
            </span>
            <span>
              <span className="block whitespace-nowrap text-base font-semibold">Take photo</span>
              <span className="block text-xs opacity-80">Claude identifies it</span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={startScan}
            className="flex h-36 flex-col justify-between rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
              <BarcodeIcon />
            </span>
            <span>
              <span className="block whitespace-nowrap text-base font-semibold">Scan barcode</span>
              <span className="block text-xs text-muted">UPC or EAN</span>
            </span>
          </button>
        </div>

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
            placeholder="Or type a barcode"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            className="field h-14 rounded-full pl-5 pr-28"
          />
          <button
            type="submit"
            disabled={!manualValid || busy}
            className="btn btn-primary absolute right-1.5 top-1.5 min-h-11 px-4 text-sm shadow-none"
          >
            Search
          </button>
        </form>

        {status.kind === "idle" && <HowItWorks />}

        {status.kind === "loading" && <LoadingResults label={status.label} preview={status.preview} />}

        {status.kind === "error" && (
          <p role="alert" className="notice notice-bad fade-in">
            {status.message}
          </p>
        )}

        {status.kind === "done" && <Results data={status.data} preview={status.preview} />}

        {scanning && <BarcodeScanner onDetected={lookupBarcode} onClose={() => setScanning(false)} />}
      </main>
    </>
  );
}

function HowItWorks() {
  const steps = [
    ["Identify", "Photo or barcode finds the same item."],
    ["Price", "Recent sold and current eBay prices."],
    ["List", "Claude writes an SEO listing you review."],
  ];
  return (
    <ol className="card grid gap-4 fade-in">
      {steps.map(([title, text], i) => (
        <li key={title} className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">
            {i + 1}
          </span>
          <span>
            <span className="block font-semibold leading-tight">{title}</span>
            <span className="block text-sm text-muted">{text}</span>
          </span>
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

function Results({ data, preview }: { data: LookupResponse; preview?: string }) {
  const id = data.identification;
  return (
    <section className="flex flex-col gap-4 fade-in">
      <div className="card">
        <div className="flex gap-3">
          {preview && <Thumb src={preview} />}
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{id ? "We think it's" : "Barcode match"}</p>
            {id ? (
              <>
                <h2 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight">{id.title || "Unknown item"}</h2>
                <ConfidenceBadge level={id.confidence} />
              </>
            ) : (
              <>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight">Barcode {data.gtin}</h2>
                <p className="text-sm text-muted">{data.results.items[0]?.title ?? "No match found on eBay"}</p>
              </>
            )}
          </div>
        </div>
        {id && (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
            {id.brand && <Row label="Brand" value={id.brand} />}
            {id.model && <Row label="Model" value={id.model} />}
            {id.category && <Row label="Category" value={id.category} />}
            {data.gtin && <Row label="Barcode" value={data.gtin} />}
            {id.conditionNotes && <Row label="Condition" value={id.conditionNotes} />}
          </dl>
        )}
        {data.query && <p className="mt-3 text-xs text-subtle">Searched eBay for “{data.query}”</p>}
        {data.notes.map((n) => (
          <p key={n} className="notice notice-warn mt-3 text-xs">
            {n}
          </p>
        ))}
        <Link href={listingHref(data)} className="btn btn-primary btn-lg mt-4 w-full">
          Create listing
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>

      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-base font-semibold tracking-tight">
          {data.results.items.length ? "Similar on eBay" : "No similar items on eBay"}
        </h3>
        {data.results.items.length > 0 && (
          <span className="text-sm text-muted">{data.results.total.toLocaleString()} found</span>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {data.results.items.map((item) => (
          <ListingCard key={item.itemId} item={item} />
        ))}
      </ul>
    </section>
  );
}

function ListingCard({ item }: { item: ItemSummary }) {
  return (
    <li>
      <a
        href={item.itemWebUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-card transition-colors active:bg-surface-2"
      >
        {item.imageUrl ? (
          // eBay image hosts vary, so a plain img avoids next/image domain config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-surface-2 object-cover" />
        ) : (
          <div className="h-20 w-20 shrink-0 rounded-xl bg-surface-2" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="line-clamp-2 text-sm leading-snug">{item.title}</p>
          <p className="mt-auto pt-1 text-lg font-bold tracking-tight">{money(item.price)}</p>
          <p className="truncate text-xs text-muted">
            {item.shippingCost
              ? Number(item.shippingCost.value) === 0
                ? "Free shipping"
                : `+${money(item.shippingCost)} shipping`
              : "Shipping n/a"}
            {item.itemCountry && ` · from ${item.itemCountry}`}
            {item.condition && ` · ${item.condition}`}
          </p>
        </div>
      </a>
    </li>
  );
}

function money(p?: { value: string; currency: string }) {
  if (!p) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value));
  } catch {
    return `${p.value} ${p.currency}`;
  }
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-ok-soft text-ok-ink",
    medium: "bg-warn-soft text-warn-ink",
    low: "bg-bad-soft text-bad-ink",
  }[level];
  const text = { high: "Confident match", medium: "Best guess", low: "Rough guess" }[level];
  return <span className={`chip mt-1.5 ${styles}`}>{text}</span>;
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

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" strokeLinecap="round" />
    </svg>
  );
}
