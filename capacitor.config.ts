import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is a thin native shell around the hosted Next.js server.
 * It loads CAP_SERVER_URL (e.g. https://ebay-lister.vercel.app), so eBay and
 * Claude keys stay on the server, and the native camera and barcode plugins
 * are injected into those pages by Capacitor.
 *
 * For phone testing against your laptop, use your LAN address:
 *   CAP_SERVER_URL=http://192.168.1.20:3000 npm run cap:sync
 */
// Accept a bare host ("my-app.vercel.app") and assume HTTPS.
function normaliseServerUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return undefined;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    throw new Error(`CAP_SERVER_URL is not a valid web address: "${raw}"`);
  }
}

const serverUrl = normaliseServerUrl(process.env.CAP_SERVER_URL);

// Hosts the in-app web view may open without leaving the app:
// the server itself plus eBay's sign-in pages (OAuth consent).
const allowNavigation = [
  "auth.ebay.com",
  "auth.sandbox.ebay.com",
  "signin.ebay.com",
  "signin.sandbox.ebay.com",
  "*.ebay.com",
];
if (serverUrl) allowNavigation.unshift(new URL(serverUrl).host);

const config: CapacitorConfig = {
  appId: "com.teodem1.ebaylister",
  appName: "eBay Lister",
  webDir: "capacitor-shell",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
        allowNavigation,
        errorPath: "index.html",
      }
    : undefined,
  android: {
    // Keep HTTP only for local LAN testing.
    allowMixedContent: false,
  },
};

export default config;
