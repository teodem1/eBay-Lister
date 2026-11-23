/**
 * Picks the phone's main back camera (the 1x lens). With several back lenses,
 * browsers may open the ultra-wide (0.5x) or telephoto for "environment".
 * Android names them "camera2 0, facing back", "camera2 2, facing back"...:
 * the lowest number is the main lens. Labels are only filled in after
 * camera permission is granted.
 */
export function pickMainBackCamera(devices: { deviceId: string; label: string; kind: string }[]): string | null {
  const back = devices.filter((d) => d.kind === "videoinput" && /back|rear|environment/i.test(d.label));
  if (!back.length) return null;
  // Skip lenses that name themselves: ultra-wide, telephoto, and iPhone's multi-lens
  // "Dual/Triple" cameras (which open at 0.5x).
  const plain = back.filter((d) => !/ultra|tele|macro|depth|dual|triple/i.test(d.label));
  const pool = plain.length ? plain : back;
  const num = (label: string) => {
    const m = label.match(/camera\d?\s*(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return [...pool].sort((a, b) => num(a.label) - num(b.label))[0].deviceId;
}

/** Back camera stream on the main (1x) lens, with zoom at 1x where the browser exposes it. */
export async function openMainBackCamera(): Promise<MediaStream> {
  let stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  try {
    const main = pickMainBackCamera(await navigator.mediaDevices.enumerateDevices());
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (main && main !== current) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: main }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
    }
    const track = stream.getVideoTracks()[0];
    const zoom = (track?.getCapabilities?.() as { zoom?: { min: number; max: number } } | undefined)?.zoom;
    if (track && zoom && zoom.min <= 1 && zoom.max >= 1) {
      await track.applyConstraints({ advanced: [{ zoom: 1 } as MediaTrackConstraintSet] });
    }
  } catch {
    // Keep whatever camera opened first.
  }
  return stream;
}
