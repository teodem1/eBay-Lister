# Phone app: PWA and Android APK

The app runs on your phone two ways. Both load the same Next.js server, so
eBay and Claude keys stay on the server and never ship inside the app.

1. **Installable web app (PWA).** Open the hosted site in Chrome on Android and
   choose *Add to Home screen* / *Install app*. Works today, no build needed.
2. **Android APK (Capacitor).** A thin native shell that loads the hosted
   server and adds the native camera and Google's ML Kit barcode scanner.

## 1. Host the server (needed for both)

The phone needs the server on the internet over HTTPS. Vercel is the simplest:

1. Import `teodem1/eBay-Lister` at <https://vercel.com/new>.
2. Add the variables from `.env.example` (eBay keys, later the Anthropic key)
   under *Settings > Environment Variables*.
3. Deploy. Note the URL, e.g. `https://ebay-lister.vercel.app`.

## 2. Build the APK

### Option A: GitHub Actions (no Android Studio needed)

1. In the repo, *Settings > Secrets and variables > Actions > Variables*, add
   `CAP_SERVER_URL` = your Vercel URL.
2. *Actions > Build Android APK > Run workflow*.
3. Download the `ebay-lister-debug-apk` artifact, unzip, copy `app-debug.apk`
   to the phone and open it (allow "install unknown apps" once).

**Updating in place.** Android only installs a new APK over the old one when
both are signed with the same key and the new one has a higher version.
The workflow uses the run number (+100) as the version, and signs with the
key in the repository secret `ANDROID_KEYSTORE_BASE64` (a base64 PKCS12
keystore, alias `ebaylister`, password `ebaylister` unless the optional secret
`ANDROID_KEYSTORE_PASSWORD` says otherwise). Keep a copy of that key: an APK
signed with any other key will not update the app, and the phone would need
an uninstall (which wipes the phone-only Collection, so back it up first).
To make a new key:

```bash
keytool -genkeypair -keystore ebaylister.keystore -storetype PKCS12 \
  -alias ebaylister -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass ebaylister -keypass ebaylister -dname "CN=eBay Lister"
base64 -w0 ebaylister.keystore   # paste the output into the secret
```

Without the secret the run still builds, with a warning, but that APK gets a
one-off key and will not install over the app.

### Option B: on your computer

Needs Android Studio (it brings the Android SDK) and JDK 21.

```bash
npm install
CAP_SERVER_URL=https://ebay-lister.vercel.app npm run cap:sync
npm run cap:open            # opens Android Studio, press Run with the phone plugged in
# or, without the IDE:
CAP_SERVER_URL=https://ebay-lister.vercel.app npm run android:apk
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

**Testing against your laptop:** start `npm run dev -- -H 0.0.0.0`, then sync
with your LAN address, e.g. `CAP_SERVER_URL=http://192.168.1.20:3000`. Plain
HTTP is allowed only when the URL starts with `http://`.

## Check the phone features

Open `/device-check` in the app. "Take item photo" and "Scan barcode" should
both work. The first barcode scan may take a few seconds while Google Play
services downloads the scanner.

## How it fits together

| Piece | Where |
| --- | --- |
| Web manifest, icons, theme colour | `src/app/manifest.ts`, `public/icons/` |
| Service worker (offline page only, never caches `/api/`) | `public/sw.js`, registered in `src/components/ServiceWorkerRegister.tsx` |
| Capacitor config (server URL, allowed eBay sign-in hosts) | `capacitor.config.ts` |
| Offline / no-server page bundled in the APK | `capacitor-shell/index.html` |
| Camera and barcode helpers for screens to call | `src/lib/native/camera.ts`, `src/lib/native/barcode.ts` |
| Android project (permissions, ML Kit metadata, icons) | `android/` |

Screens should call `takeItemPhoto()` and `scanBarcode()` rather than the
plugins directly. They use the native plugins in the APK and fall back to the
browser camera (and `BarcodeDetector` where Chrome supports it) on the web.
`scanBarcode()` returns `null` when nothing could be read, so screens should
offer typing the barcode as a fallback.

The lookup screen (`src/components/ItemLookup.tsx`) does this: in the APK,
"Scan barcode" opens the ML Kit scanner and "Take photo" opens the native
camera. In a browser, "Scan barcode" keeps the live camera scanner
(`src/components/BarcodeScanner.tsx`), which reads codes continuously.

Icons are generated from `assets/icon.svg` / `assets/icon-only.png`; rerun
`npx @capacitor/assets generate --android --iconBackgroundColor '#0f766e'` after changing them.

## Release build (later)

Play Store or a signed APK needs a release keystore. Keep it out of git and
pass its passwords as environment variables or GitHub secrets.
