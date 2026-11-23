import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "./platform";

export type SaveResult = "shared" | "downloaded" | "copied" | "cancelled";

/**
 * Hands a text file (e.g. a backup) to the user.
 * - Android app: writes it to the app cache and opens the share sheet
 *   (Drive, Gmail, Files...). The WebView can't download files.
 * - Android app built before the Share plugin was added: copies the text to
 *   the clipboard so it can be pasted into a note or email.
 * - Browser: the share sheet when it accepts the file, else a download.
 */
export async function saveTextFile(name: string, text: string, title: string): Promise<SaveResult> {
  if (isNativeApp()) {
    if (Capacitor.isPluginAvailable("Share") && Capacitor.isPluginAvailable("Filesystem")) {
      return shareNative(name, text, title);
    }
    await copyText(text);
    return "copied";
  }
  const file = new File([text], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

async function shareNative(name: string, text: string, title: string): Promise<SaveResult> {
  // Loaded only in the Android app, so browsers never download the plugins.
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title, files: [uri], dialogTitle: title });
    return "shared";
  } catch (err) {
    if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return "cancelled";
    throw err;
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Older WebViews: fall back to a hidden textarea.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("Couldn't copy the backup.");
}
