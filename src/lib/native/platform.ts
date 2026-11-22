import { Capacitor } from "@capacitor/core";

/** True inside the Android app, false in a normal browser or installed PWA. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
