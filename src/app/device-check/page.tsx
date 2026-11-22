"use client";

import { useState, useSyncExternalStore } from "react";
import { takeItemPhoto } from "@/lib/native/camera";
import { scanBarcode } from "@/lib/native/barcode";
import { isNativeApp } from "@/lib/native/platform";

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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Device check</h1>
      <p className="text-sm text-zinc-500">
        Running as: {runtime}
      </p>
      <button
        onClick={onPhoto}
        className="h-12 rounded-full bg-teal-700 px-5 text-white"
      >
        Take item photo
      </button>
      <button
        onClick={onScan}
        className="h-12 rounded-full border border-teal-700 px-5 text-teal-700"
      >
        Scan barcode
      </button>
      {status && <p role="status">{status}</p>}
      {code && (
        <p className="font-mono text-lg">
          Barcode: <strong>{code}</strong>
        </p>
      )}
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="Captured item" className="rounded-lg" />
      )}
    </main>
  );
}
