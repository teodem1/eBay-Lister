import {
  BarcodeFormat,
  BarcodeScanner,
} from "@capacitor-mlkit/barcode-scanning";
import { isCancel, pickFileFromInput } from "./camera";
import { isNativeApp } from "./platform";

/** Product barcodes found on retail items (EAN/UPC), plus common extras. */
const PRODUCT_FORMATS = [
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.Code128,
  BarcodeFormat.QrCode,
];

/**
 * Scan a product barcode and return its digits, or null if cancelled / not found.
 * Android app: Google's ML Kit scanner UI (no camera permission prompt needed).
 * Browser/PWA: take a photo and read it with the browser's BarcodeDetector
 * (Chrome on Android supports it). Returns null where it is unsupported, so
 * the screen can fall back to typing the number.
 */
export async function scanBarcode(): Promise<string | null> {
  if (isNativeApp()) return scanNative();
  return scanWeb();
}

async function scanNative(): Promise<string | null> {
  try {
    const { available } =
      await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      // First run on a phone: Play services downloads the scanner module.
      await BarcodeScanner.installGoogleBarcodeScannerModule();
    }
    const { barcodes } = await BarcodeScanner.scan({
      formats: PRODUCT_FORMATS,
    });
    return barcodes[0]?.rawValue ?? null;
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
};

export function webBarcodeSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function scanWeb(): Promise<string | null> {
  if (!webBarcodeSupported()) return null;
  const file = await pickFileFromInput({
    accept: "image/*",
    capture: "environment",
  });
  if (!file) return null;
  const Detector = (window as unknown as { BarcodeDetector: DetectorCtor })
    .BarcodeDetector;
  const detector = new Detector({
    formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
  });
  const bitmap = await createImageBitmap(file);
  const found = await detector.detect(bitmap);
  return found[0]?.rawValue ?? null;
}
