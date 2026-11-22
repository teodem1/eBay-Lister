import { beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => true);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

const takePhoto = vi.fn();
vi.mock("@capacitor/camera", () => ({
  Camera: { takePhoto: (o: unknown) => takePhoto(o) },
  CameraDirection: { Rear: "REAR" },
  EncodingType: { JPEG: 0 },
}));

const scan = vi.fn();
const isAvailable = vi.fn();
const install = vi.fn();
vi.mock("@capacitor-mlkit/barcode-scanning", () => ({
  BarcodeFormat: {
    Ean13: "EAN_13",
    Ean8: "EAN_8",
    UpcA: "UPC_A",
    UpcE: "UPC_E",
    Code128: "CODE_128",
    QrCode: "QR_CODE",
  },
  BarcodeScanner: {
    scan: (o: unknown) => scan(o),
    isGoogleBarcodeScannerModuleAvailable: () => isAvailable(),
    installGoogleBarcodeScannerModule: () => install(),
  },
}));

const { scanBarcode, webBarcodeSupported } = await import("./barcode");
const { takeItemPhoto } = await import("./camera");

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(true);
});

describe("scanBarcode (Android app)", () => {
  it("returns the first barcode's digits", async () => {
    isAvailable.mockResolvedValue({ available: true });
    scan.mockResolvedValue({ barcodes: [{ rawValue: "5012345678900" }] });
    await expect(scanBarcode()).resolves.toBe("5012345678900");
    expect(install).not.toHaveBeenCalled();
    expect(scan.mock.calls[0][0].formats).toContain("EAN_13");
  });

  it("installs the scanner module on first use", async () => {
    isAvailable.mockResolvedValue({ available: false });
    scan.mockResolvedValue({ barcodes: [] });
    await expect(scanBarcode()).resolves.toBeNull();
    expect(install).toHaveBeenCalledOnce();
  });

  it("treats a cancelled scan as null", async () => {
    isAvailable.mockResolvedValue({ available: true });
    scan.mockRejectedValue(new Error("scan canceled."));
    await expect(scanBarcode()).resolves.toBeNull();
  });

  it("rethrows real errors", async () => {
    isAvailable.mockResolvedValue({ available: true });
    scan.mockRejectedValue(new Error("Google Play services missing"));
    await expect(scanBarcode()).rejects.toThrow("Play services");
  });
});

describe("scanBarcode (browser without BarcodeDetector)", () => {
  it("returns null so the screen can offer manual entry", async () => {
    isNativePlatform.mockReturnValue(false);
    expect(webBarcodeSupported()).toBe(false);
    await expect(scanBarcode()).resolves.toBeNull();
  });
});

describe("takeItemPhoto (Android app)", () => {
  it("turns the native photo into an upload-ready File", async () => {
    takePhoto.mockResolvedValue({ webPath: "https://localhost/_capacitor_file_/x.jpg" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Blob(["jpg"], { type: "image/jpeg" })));
    const file = await takeItemPhoto();
    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe("image/jpeg");
    expect(takePhoto.mock.calls[0][0]).toMatchObject({ targetWidth: 1600 });
    fetchMock.mockRestore();
  });

  it("returns null when the user backs out of the camera", async () => {
    takePhoto.mockRejectedValue(new Error("User cancelled photos app"));
    await expect(takeItemPhoto()).resolves.toBeNull();
  });
});
