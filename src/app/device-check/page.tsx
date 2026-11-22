"use client";

import { useState, useSyncExternalStore } from "react";
import { takeItemPhoto } from "@/lib/native/camera";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";
import { AppBar } from "@/components/ui";

/**
 * Test page for the phone build: checks the camera and barcode scanner work
 * in the Android app and in the browser. Open /device-check on the phone.
 */
const noopSubscribe = () => () => {};

export default function DeviceCheck() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const runtime = useSyncExternalStore(
    noopSubscribe,
    () => (isNativeApp() ? "Android app" : "browser"),
    () => "…",
  );

  async function onPhoto() {
    setStatus("Opening camera…");
    try {
      const file = await takeItemPhoto();
      if (!file) return setStatus("Cancelled.");
      setPhotoUrl(URL.createObjectURL(file));
      setStatus(`Photo OK: ${Math.round(file.size / 1024)} KB, ${file.type}`);
    } catch (e) {
      setStatus(`Camera error: ${String(e)}`);
    }
  }

  async function onScan() {
    setStatus("Opening scanner…");
    try {
      const value = await scanBarcode();
      setCode(value);
      setStatus(value ? "Barcode OK." : "No barcode read (or not supported here).");
    } catch (e) {
      setStatus(`Scanner error: ${String(e)}`);
    }
  }

  return (
    <>
      <AppBar title="Device check" back={{ href: "/", label: "Back to lookup" }} />
      <main className="page">
        <div className="card flex items-center justify-between">
          <span className="text-sm text-muted">Running as</span>
          <span className="chip bg-brand-soft text-brand-ink">{runtime}</span>
        </div>
        <div className="grid gap-3">
          <button onClick={onPhoto} className="btn btn-primary btn-lg">
            Take item photo
          </button>
          <button onClick={onScan} className="btn btn-secondary btn-lg">
            Scan barcode
          </button>
        </div>
        {status && (
          <p role="status" className="card text-sm">
            {status}
          </p>
        )}
        {code && (
          <p className="card font-mono text-lg">
            Barcode: <strong>{code}</strong>
          </p>
        )}
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Captured item" className="rounded-2xl border border-line" />
        )}
      </main>
    </>
  );
}
