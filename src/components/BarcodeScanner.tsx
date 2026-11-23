"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onDetected: (code: string) => void;
  onClose: () => void;
  /** Keep scanning after each code (a stack of CDs); the same code is ignored for a few seconds. */
  continuous?: boolean;
  /** Shown at the bottom in continuous mode, e.g. "3 scanned · last: OK Computer". */
  status?: string;
}

// In continuous mode, the same barcode read again within this time is the same CD.
const REPEAT_MS = 3000;

// Retail barcode formats only (UPC/EAN). QR codes are not product codes.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = new (opts: { formats: string[] }) => NativeDetector;

/**
 * Live camera barcode scanner. Uses the browser's BarcodeDetector where it
 * exists (Chrome on Android) and falls back to ZXing (iPhone Safari, Firefox).
 * Needs HTTPS (or localhost) for camera access.
 */
export default function BarcodeScanner({ onDetected, onClose, continuous = false, status }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const detectedRef = useRef(onDetected);
  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  const continuousRef = useRef(continuous);
  const last = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopScan: (() => void) | undefined;
    const video = videoRef.current!;

    const found = (code: string) => {
      if (cancelled) return;
      if (continuousRef.current) {
        const now = Date.now();
        if (last.current && last.current.code === code && now - last.current.at < REPEAT_MS) {
          last.current.at = now;
          return false;
        }
        last.current = { code, at: now };
        navigator.vibrate?.(80);
        detectedRef.current(code);
        return false;
      }
      cancelled = true;
      stopScan?.();
      navigator.vibrate?.(80);
      detectedRef.current(code);
      return true;
    };

    async function start() {
      const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
      if (Native) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Native({ formats: FORMATS });
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue && found(codes[0].rawValue)) return;
          } catch {
            // Frame not ready yet; try the next one.
          }
          timer = setTimeout(tick, 150);
        };
        stopScan = () => {
          clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
        };
        tick();
        return;
      }

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" }, audio: false },
        video,
        (result) => {
          if (result) found(result.getText());
        },
      );
      stopScan = () => controls.stop();
      if (cancelled) controls.stop();
    }

    start().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was refused. Allow it in your browser settings, or type the barcode below."
          : "Couldn't open the camera. Type the barcode below instead.",
      );
    });

    return () => {
      cancelled = true;
      stopScan?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black fade-in">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
      {/* Aiming guide */}
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-36 -translate-y-1/2 rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse rounded-full bg-white/90 shadow-[0_0_12px_2px_rgba(255,255,255,0.45)]" />
      </div>
      <div className="absolute inset-x-0 top-0 pt-[calc(env(safe-area-inset-top)+1.5rem)] text-center">
        <p className="mx-auto inline-block rounded-full bg-black/50 px-4 py-2 text-sm font-medium text-white backdrop-blur">
          {continuous ? "Scan each CD, one after another" : "Point at the barcode"}
        </p>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        {error && (
          <p role="alert" className="w-full max-w-md rounded-2xl bg-red-600/95 p-3 text-sm text-white">
            {error}
          </p>
        )}
        {continuous && status && (
          <p role="status" className="w-full max-w-md truncate rounded-2xl bg-black/60 px-4 py-3 text-center text-sm font-medium text-white backdrop-blur">
            {status}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="btn min-w-40 bg-white/15 text-white backdrop-blur-md active:bg-white/25"
        >
          {continuous ? "Done" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
