"use client";

import { useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import { isCancel, takeItemPhoto } from "@/lib/native/camera";
import CdCamera from "./CdCamera";
import { resizeImage } from "@/lib/resize-image";

const MAX_PHOTOS = 24; // eBay's limit

async function uploadPhoto(file: File): Promise<string> {
  // Square like a CD (centre crop), 1600px: eBay's largest size; smaller uploads are faster on mobile data.
  const blob = await resizeImage(file, 1600, 0.88, { square: true });
  const form = new FormData();
  form.append("photo", blob, "photo.jpg");
  const res = await fetch("/api/listing/photo", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? "Photo upload failed");
  return data.url as string;
}

/** Opens the gallery and resolves with every photo picked. */
function pickFromGallery(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** The photo URLs in the listing's photo text (one per line). */
export function photoUrls(text: string): string[] {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Photos for the listing: take them with the camera or pick from the gallery.
 * Each one uploads to eBay straight away; the listing keeps eBay's URLs.
 */
export default function PhotoPicker({
  text,
  setText,
}: {
  /** Photo URLs, one per line: the listing's source of truth. */
  text: string;
  setText: (update: (prev: string) => string) => void;
}) {
  const urls = photoUrls(text);
  // Updates from the latest text, so removals during an upload aren't lost.
  const onChange = (fn: (prev: string[]) => string[]) => setText((prev) => fn(photoUrls(prev)).join("\n"));
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const full = urls.length + uploading >= MAX_PHOTOS;

  async function add(files: File[]) {
    const room = MAX_PHOTOS - urls.length - uploading;
    const batch = files.slice(0, Math.max(0, room));
    if (!batch.length) return;
    setError(null);
    setUploading((n) => n + batch.length);
    // Upload one at a time so photos keep the order they were taken in.
    for (const file of batch) {
      try {
        const url = await uploadPhoto(file);
        onChange((prev) => [...prev, url]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  // In-app camera with a square CD guide; the phone's own camera if it can't open.
  const [camera, setCamera] = useState(false);
  async function systemCamera() {
    try {
      const file = await takeItemPhoto();
      if (file) await add([file]);
    } catch (e) {
      if (!isCancel(e)) setError((e as Error).message);
    }
  }

  const makeMain = (url: string) => onChange((prev) => [url, ...prev.filter((u) => u !== url)]);

  return (
    <div className="card space-y-3">
      {camera && (
        <CdCamera
          onShot={(file) => add([file])}
          onClose={() => setCamera(false)}
          onUnavailable={() => {
            setCamera(false);
            systemCamera();
          }}
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-headline">Photos</span>
        <span className="t-small text-muted tabular-nums">
          {urls.length}/{MAX_PHOTOS}
        </span>
      </div>

      {(urls.length > 0 || uploading > 0) && (
        <ul className="grid grid-cols-3 gap-2">
          {urls.map((u, i) => (
            <li key={u} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo */}
              <img src={u} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 && <span className="chip absolute left-1 top-1 bg-surface/90 py-0 text-xs">Main</span>}
              <div className="absolute inset-x-1 bottom-1 flex justify-between">
                {i > 0 ? (
                  <button
                    type="button"
                    className="icon-btn h-9 w-9 bg-surface/90"
                    aria-label={`Make photo ${i + 1} the main photo`}
                    onClick={() => makeMain(u)}
                  >
                    <Icon name="back" size={16} />
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  className="icon-btn h-9 w-9 bg-surface/90"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => onChange((prev) => prev.filter((p) => p !== u))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up-${i}`} className="skeleton flex aspect-square items-center justify-center rounded-xl">
              <Spinner />
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary h-14 px-5" disabled={full} onClick={() => setCamera(true)}>
          <Icon name="camera" size={22} strokeWidth={1.8} />
          Take photo
        </button>
        <button
          type="button"
          className="btn btn-secondary h-14 px-5"
          disabled={full}
          onClick={async () => add(await pickFromGallery())}
        >
          <Icon name="plus" size={22} strokeWidth={1.8} />
          Gallery
        </button>
      </div>

      {error && (
        <p role="alert" className="notice notice-bad">
          {error}
        </p>
      )}

      <p className="hint">
        The first photo is the main one. Photos are cropped to a square like a CD, so keep the CD centred. Shoot the front cover, back, disc and any defects. Photos upload to eBay as you add them.
      </p>

      <button type="button" className="t-small font-medium text-brand-ink underline" onClick={() => setShowLinks((s) => !s)}>
        {showLinks ? "Hide photo links" : "Paste photo links instead"}
      </button>
      {showLinks && (
        <label className="block">
          <span className="label">Photo URLs, one per line (https)</span>
          <textarea
            className="field"
            rows={3}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(() => v);
            }}
            placeholder="https://…"
          />
        </label>
      )}
    </div>
  );
}
