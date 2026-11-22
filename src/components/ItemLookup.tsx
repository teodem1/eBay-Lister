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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pb-10 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Find your item</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Take a photo or scan the barcode to find the same item on eBay.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={startPhoto}
          className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-blue-600 text-white shadow-sm active:bg-blue-700 disabled:opacity-50"
        >
          <CameraIcon />
          <span className="font-medium">Take photo</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={startScan}
          className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white shadow-sm active:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <BarcodeIcon />
          <span className="font-medium">Scan barcode</span>
        </button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualValid) lookupBarcode(manualCode);
        }}
      >
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="Or type the barcode number"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={!manualValid || busy}
          className="h-12 rounded-xl bg-zinc-200 px-4 font-medium active:bg-zinc-300 disabled:opacity-40 dark:bg-zinc-800"
        >
          Search
        </button>
      </form>

      {status.kind === "loading" && (
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          {status.preview && <Thumb src={status.preview} />}
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
          <span className="text-sm">{status.label}</span>
        </div>
      )}

      {status.kind === "error" && (
        <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {status.message}
        </p>
      )}

      {status.kind === "done" && <Results data={status.data} preview={status.preview} />}

      {scanning && <BarcodeScanner onDetected={lookupBarcode} onClose={() => setScanning(false)} />}
    </main>
  );
}

function Results({ data, preview }: { data: LookupResponse; preview?: string }) {
  const id = data.identification;
  return (
    <section className="flex flex-col gap-4">
      <Link
        href={listingHref(data)}
        className="flex h-14 items-center justify-center rounded-2xl bg-blue-600 text-lg font-semibold text-white shadow-sm active:bg-blue-700"
      >
        Create listing
      </Link>
      <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex gap-3">
          {preview && <Thumb src={preview} />}
          <div className="min-w-0 flex-1">
            {id ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold leading-snug">{id.title || "Unknown item"}</h2>
                </div>
                <ConfidenceBadge level={id.confidence} />
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {id.brand && <Row label="Brand" value={id.brand} />}
                  {id.model && <Row label="Model" value={id.model} />}
                  {id.category && <Row label="Category" value={id.category} />}
                  {data.gtin && <Row label="Barcode" value={data.gtin} />}
                  {id.conditionNotes && <Row label="Condition" value={id.conditionNotes} />}
                </dl>
              </>
            ) : (
              <>
                <h2 className="font-semibold">Barcode {data.gtin}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {data.results.items[0]?.title ?? "No match found on eBay"}
                </p>
              </>
            )}
          </div>
        </div>
        {data.query && (
          <p className="mt-3 text-xs text-zinc-500">Searched eBay for “{data.query}”</p>
        )}
        {data.notes.map((n) => (
          <p key={n} className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {n}
          </p>
        ))}
      </div>

      <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {data.results.items.length
          ? `Similar items on eBay (${data.results.total.toLocaleString()} found)`
          : "No similar items on eBay"}
      </h3>
      <ul className="flex flex-col gap-2">
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
        className="flex gap-3 rounded-xl border border-zinc-200 p-2 active:bg-zinc-50 dark:border-zinc-800 dark:active:bg-zinc-900"
      >
        {item.imageUrl ? (
          // eBay image hosts vary, so a plain img avoids next/image domain config.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug">{item.title}</p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{money(item.price)}</span>
            <span className="text-zinc-500">
              {" · "}
              {item.shippingCost
                ? Number(item.shippingCost.value) === 0
                  ? "free shipping"
                  : `+${money(item.shippingCost)} shipping`
                : "shipping n/a"}
              {item.itemCountry && ` · from ${item.itemCountry}`}
            </span>
          </p>
          {item.condition && <p className="text-xs text-zinc-500">{item.condition}</p>}
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
    high: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    low: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  }[level];
  const text = { high: "Confident match", medium: "Best guess", low: "Rough guess" }[level];
  return <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{text}</span>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}

function Thumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Your photo" className="h-16 w-16 shrink-0 rounded-lg object-cover" />;
}

function CameraIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" strokeLinecap="round" />
    </svg>
  );
}
