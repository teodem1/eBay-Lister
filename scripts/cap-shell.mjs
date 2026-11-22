// Writes the server address into the small offline shell bundled in the APK,
// so its "Try again" button knows where to go. Run before `cap sync`.
import { writeFileSync } from "node:fs";

// Same rule as capacitor.config.ts: a bare host means https://host.
const raw = (process.env.CAP_SERVER_URL ?? "").trim().replace(/\/+$/, "");
const url = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
if (!url) {
  console.warn(
    "CAP_SERVER_URL is not set: the app will only show the offline shell.",
  );
}
writeFileSync(
  new URL("../capacitor-shell/server.js", import.meta.url),
  `window.CAP_SERVER_URL = ${JSON.stringify(url)};\n`,
);
