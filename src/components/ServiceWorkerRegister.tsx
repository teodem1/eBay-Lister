"use client";

import { useEffect } from "react";

/** Registers /sw.js so the web app can be installed to the home screen. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.warn("Service worker registration failed", err));
  }, []);
  return null;
}
