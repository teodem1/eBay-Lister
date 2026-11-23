"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openMainBackCamera } from "@/lib/native/mainCamera";

/**
 * In-app camera for listing photos, with a square guide to centre the CD.
 * The shot is the part of the picture inside the guide (a square), as a JPEG.
 * `onUnavailable` is called when the live camera can't open, so the caller
 * can fall back to the phone's own camera.
 */
export default function CdCamera({
  onShot,
  onClose,
  onUnavailable,
}: {
  onShot: (file: File) => void;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);
  // Guide side in px: fits inside the visible camera picture (never zooms the picture in).
  const [guideSide, setGuideSide] = useState<number | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const fit = () => {
      if (!video.videoWidth) return;
      const box = video.getBoundingClientRect();
      const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
      setGuideSide(Math.round(0.92 * Math.min(video.videoWidth * scale, video.videoHeight * scale)));
    };
    video.addEventListener("loadedmetadata", fit);
    video.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      video.removeEventListener("loadedmetadata", fit);
      video.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    // The main 1x back lens, not the ultra-wide.
    (navigator.mediaDevices ? openMainBackCamera() : Promise.reject(new Error("no camera")))
      .then(async (s) => {
        stream = s;
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = s;
        await video.play();
        setReady(true);
      })
      .catch(() => !cancelled && unavailable.current());
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function shoot() {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth) return;
    // The whole camera picture is shown (object-contain, no zoom): map the guide's box back to video pixels.
    const box = video.getBoundingClientRect();
    const g = guide.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const offX = (video.videoWidth * scale - box.width) / 2;
    const offY = (video.videoHeight * scale - box.height) / 2;
    const side = Math.min(g.width / scale, video.videoWidth, video.videoHeight);
    const sx = Math.max(0, Math.min(video.videoWidth - side, (g.left - box.left + offX) / scale));
    const sy = Math.max(0, Math.min(video.videoHeight - side, (g.top - box.top + offY) / scale));
    const out = Math.min(1600, Math.round(side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    canvas.getContext("2d")!.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onShot(new File([blob], `cd-${Date.now()}.jpg`, { type: "image/jpeg" }));
        setCount((n) => n + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
      },
      "image/jpeg",
      0.9,
    );
  }

  // Portal to <body>: the listing cards animate with a transform, which would trap a fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black fade-in" role="dialog" aria-modal aria-label="Take listing photos">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" playsInline muted />
      {/* Square guide the size of the CD, with a disc outline to line up with */}
      <div
        ref={guideRef}
        style={guideSide ? { width: guideSide } : undefined}
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(84vw,60vh)] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
      >
        <div className="absolute inset-[6%] rounded-full border border-dashed border-white/50" />
        <div className="absolute left-1/2 top-1/2 h-[13%] w-[13%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/50" />
      </div>
      {flash && <div className="absolute inset-0 bg-white/60" />}
      <div className="absolute inset-x-0 top-0 pt-[calc(env(safe-area-inset-top)+1.5rem)] text-center">
        <p className="mx-auto inline-block rounded-full bg-black/50 px-4 py-2 text-sm font-medium text-white backdrop-blur">
          {ready ? "Fit the CD inside the square" : "Opening the camera…"}
        </p>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
        <button type="button" onClick={onClose} className="btn min-w-24 bg-white/15 text-white backdrop-blur-md active:bg-white/25">
          {count ? "Done" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={shoot}
          disabled={!ready}
          aria-label="Take photo"
          className="h-20 w-20 rounded-full border-4 border-white bg-white/30 active:bg-white/70 disabled:opacity-40"
        />
        <span className="t-small min-w-24 text-right text-white tabular-nums">{count ? `${count} taken` : ""}</span>
      </div>
    </div>,
    document.body,
  );
}
