"use client";

import { useEffect, useRef } from "react";
import type { LookupError, LookupResponse } from "../lookup";
import { applyLookup, lookupsToStart, type BatchItem } from "./queue";
import type { BatchStore } from "./store";

/** Looks up album names for newly queued CDs, two at a time (eBay Browse + MusicBrainz, no sold-price checks). */
export function useBackgroundLookups(store: BatchStore, items: BatchItem[], hydrated: boolean) {
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!hydrated) return;
    for (const item of lookupsToStart(items, inFlight.current)) {
      inFlight.current.add(item.id);
      store.update(item.id, { lookup: "loading" });
      fetch("/api/lookup/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: item.barcode }),
      })
        .then(async (res) => {
          const json = (await res.json()) as LookupResponse | LookupError;
          if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `Error ${res.status}`);
          store.update(item.id, (x) => applyLookup(x, json));
        })
        .catch((err: unknown) => {
          store.update(item.id, { lookup: "error", error: err instanceof Error ? err.message : "Lookup failed" });
        })
        .finally(() => {
          inFlight.current.delete(item.id);
          // Wake the effect up for the next ones in line.
          store.update(item.id, (x) => ({ ...x }));
        });
    }
  }, [store, items, hydrated]);
}
