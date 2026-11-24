"use client";

import { useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import ConditionPicker, { type ConditionDraft } from "@/app/listing/ConditionPicker";
import CdCamera from "@/app/listing/CdCamera";
import { uploadPhoto } from "@/app/listing/PhotoPicker";
import { isCancel, takeItemPhoto } from "@/lib/native/camera";
import { AUTO_MAX_PHOTOS, AUTO_PHOTOS, autoState } from "@/lib/auto/auto";
import type { BatchItem } from "@/lib/batch/queue";
import { autoStore } from "@/lib/batch/store";

/**
 * What the seller does for one CD on the Auto tab: the front cover and back
 * cover photos (the camera asks for each in turn), then the disc and inlay
 * grades. Used right after each scan and when a CD on the list is opened.
 */
export default function AutoCdSteps({ item, startCamera = false }: { item: BatchItem; startCamera?: boolean }) {
  const a = autoState(item);
  // The camera opens on its own after a scan, for the front cover.
  const [camera, setCamera] = useState(startCamera && a.photos.length === 0);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const taken = a.photos.length + uploading;
  const nextLabel = AUTO_PHOTOS[taken] ?? "Extra photo";

  async function addPhoto(file: File) {
    setError(null);
    setUploading((n) => n + 1);
    try {
      const url = await uploadPhoto(file);
      autoStore.update(item.id, (x) => {
        const s = autoState(x);
        return { ...x, auto: { ...s, photos: [...s.photos, url].slice(0, AUTO_MAX_PHOTOS) } };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading((n) => n - 1);
    }
  }

  async function systemCamera() {
    try {
      const file = await takeItemPhoto();
      if (file) await addPhoto(file);
    } catch (e) {
      if (!isCancel(e)) setError((e as Error).message);
    }
  }

  function removePhoto(url: string) {
    autoStore.update(item.id, (x) => {
      const s = autoState(x);
      return { ...x, auto: { ...s, photos: s.photos.filter((p) => p !== url) } };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="t-headline">Photos</span>
          <span className="t-small text-muted tabular-nums">
            {a.photos.length}/{AUTO_MAX_PHOTOS}
          </span>
        </div>
        <ul className="grid grid-cols-4 gap-2">
          {a.photos.map((u, i) => (
            <li key={u} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo */}
              <img src={u} alt={AUTO_PHOTOS[i] ?? `Photo ${i + 1}`} className="h-full w-full object-cover" />
              <span className="chip absolute bottom-0.5 left-0.5 bg-surface/90 py-0 text-xs">{i === 0 ? "Front" : i === 1 ? "Back" : i + 1}</span>
              <button
                type="button"
                className="icon-btn absolute right-0.5 top-0.5 h-8 w-8 bg-surface/90"
                aria-label={`Remove ${AUTO_PHOTOS[i] ?? `photo ${i + 1}`}`}
                onClick={() => removePhoto(u)}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <li key={`up-${i}`} className="skeleton flex aspect-square items-center justify-center rounded-lg">
              <Spinner />
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={`btn h-14 w-full ${taken < AUTO_PHOTOS.length ? "btn-primary" : "btn-secondary"}`}
          disabled={taken >= AUTO_MAX_PHOTOS}
          onClick={() => setCamera(true)}
        >
          <Icon name="camera" size={22} strokeWidth={1.8} />
          {taken < AUTO_PHOTOS.length ? `Take the ${nextLabel.toLowerCase()} photo` : "Add more photos"}
        </button>
        {error && (
          <p role="alert" className="notice notice-bad">
            {error}
          </p>
        )}
      </div>

      <ConditionPicker compact value={item.condition ?? {}} onChange={(next: ConditionDraft) => autoStore.update(item.id, { condition: next })} />

      {camera && (
        <CdCamera
          prompt={
            taken < AUTO_PHOTOS.length
              ? `${nextLabel}: fit it inside the square`
              : taken >= AUTO_MAX_PHOTOS
                ? "That's the most photos. Tap Done."
                : "Extra photos (disc, spine, defects), or tap Done"
          }
          onShot={(file) => {
            // Front cover, back cover, then as many extra shots as wanted; Done closes the camera.
            if (taken >= AUTO_MAX_PHOTOS) return;
            addPhoto(file);
            if (taken + 1 >= AUTO_MAX_PHOTOS) setCamera(false);
          }}
          onClose={() => setCamera(false)}
          onUnavailable={() => {
            setCamera(false);
            systemCamera();
          }}
        />
      )}
    </div>
  );
}
