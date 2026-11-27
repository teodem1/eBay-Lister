"use client";

import { useState } from "react";
import { AppBar, Spinner } from "@/components/ui";
import { safeNext } from "@/lib/auth/access";

/** Asked once per phone when APP_ACCESS_KEY is set: the key unlocks the app (kept as a cookie for a year). */
export default function UnlockPage() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      window.location.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <AppBar title="Unlock" subtitle="Enter the app's access key once on this phone." />
      <main className="page flex flex-col gap-4">
        <form onSubmit={unlock} className="card flex flex-col gap-3 p-4">
          <label htmlFor="access-key" className="t-small text-muted">
            Access key
          </label>
          <input
            id="access-key"
            className="field"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {error && (
            <p role="alert" className="notice notice-bad">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
            {busy ? <Spinner /> : "Unlock"}
          </button>
        </form>
        <p className="t-caption px-1 text-muted">
          The key is the APP_ACCESS_KEY setting on the server. This phone stays unlocked for a year.
        </p>
      </main>
    </>
  );
}
