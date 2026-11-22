import { Camera, CameraDirection, EncodingType } from "@capacitor/camera";
import { isNativeApp } from "./platform";

/**
 * Take a photo of the item and return it as a File ready to upload.
 * Android app: native camera. Browser/PWA: the phone's camera via a file input.
 * Resolves to null if the user cancels.
 */
export async function takeItemPhoto(): Promise<File | null> {
  if (isNativeApp()) return takeNativePhoto();
  return pickFileFromInput({ accept: "image/*", capture: "environment" });
}

async function takeNativePhoto(): Promise<File | null> {
  try {
    const result = await Camera.takePhoto({
      quality: 80,
      targetWidth: 1600,
      targetHeight: 1600,
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      cameraDirection: CameraDirection.Rear,
      saveToGallery: false,
    });
    if (!result.webPath) return null;
    const blob = await (await fetch(result.webPath)).blob();
    return new File([blob], `item-${Date.now()}.jpg`, {
      type: blob.type || "image/jpeg",
    });
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}

export function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

/** Opens a hidden <input type="file"> and resolves with the chosen file. */
export function pickFileFromInput(opts: {
  accept: string;
  capture?: "environment" | "user";
}): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = opts.accept;
    if (opts.capture) input.setAttribute("capture", opts.capture);
    input.style.display = "none";
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
