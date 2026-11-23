"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { autoDraft, autoState, interruptedToWaiting, pickAutoPrice, readyForAuto } from "@/lib/auto/auto";
import type { AutoState, BatchItem } from "@/lib/batch/queue";
import { autoStore } from "@/lib/batch/store";
import { itemFromListing } from "@/lib/collection/collection";
import { collectionStore } from "@/lib/collection/store";
import type { GeneratedListing } from "@/lib/listing/types";
import { fetchPriceSuggestion, priceSuggestionBody } from "../listing/priceRequest";

/** CDs worked on at once: Claude takes a while per listing, eBay doesn't mind two. */
const PARALLEL = 2;

function patchAuto(id: string, patch: Partial<AutoState>) {
  autoStore.update(id, (x) => ({ ...x, auto: { ...autoState(x), ...patch } }));
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const problems: string[] = data?.problems ?? [];
    throw new Error([data?.error ?? `Error ${res.status}`, ...problems].join(" "));
  }
  return data as T;
}

type PublishOk = { listingId: string; url: string; promoted?: { percent: number } | null; promotionError?: string };

/** Price check, Claude's listing and the publish for one CD. Never throws: failures are saved on the CD. */
async function listOne(id: string): Promise<void> {
  const start = autoStore.get(id);
  if (!start) return;
  const query = start.query ?? "";
  const condition = start.condition!;
  try {
    // 1. Sold prices: one sold-comps call per CD, saved so a retry doesn't spend another.
    let check = autoState(start).priceCheck;
    if (!check) {
      patchAuto(id, { stage: "pricing", error: undefined });
      const body = priceSuggestionBody(query, start.barcode, condition.condition);
      if (!body) throw new Error("Nothing to search prices for.");
      autoStore.update(id, (x) => ({ ...x, openedAt: x.openedAt ?? new Date().toISOString() }));
      const result = await fetchPriceSuggestion(body);
      if ("error" in result) throw new Error(`Price check failed: ${result.error}`);
      check = result;
      patchAuto(id, { priceCheck: check });
    }
    const picked = pickAutoPrice(check);
    if (!picked) throw new Error("No sold or listed copies found, so there's no price to use. List it by hand.");
    patchAuto(id, { price: picked.price, priceBasis: picked.basis });

    // 2. Claude writes it (kept if a later step failed, so the same SKU is re-sent).
    let draft = autoState(autoStore.get(id)!).draft;
    const photos = autoState(autoStore.get(id)!).photos;
    if (!draft) {
      patchAuto(id, { stage: "writing", error: undefined });
      const generated = await postJson<GeneratedListing>("/api/listing/generate", {
        query,
        barcode: start.barcode || undefined,
        suggestedPrice: picked.price,
        sellerCondition: condition,
      });
      draft = autoDraft(generated, picked.price, photos);
      patchAuto(id, { draft });
    } else {
      draft = { ...draft, imageUrls: photos };
    }

    // 3. Publish (shipping, Best Offer and promotion come from the server settings).
    patchAuto(id, { stage: "publishing", error: undefined });
    const ok = await postJson<PublishOk>("/api/listing/publish", draft);
    autoStore.update(id, (x) => ({
      ...x,
      status: "listed",
      listingId: ok.listingId,
      listingUrl: ok.url,
      doneAt: new Date().toISOString(),
      auto: {
        ...autoState(x),
        stage: "published",
        draft,
        error: undefined,
        promotedPercent: ok.promoted?.percent,
        promotionError: ok.promotionError,
      },
    }));
    saveToCollection(autoStore.get(id)!);
  } catch (e) {
    patchAuto(id, { stage: "failed", error: (e as Error).message });
  }
}

/** Adds (or updates) the published CD in the Collection, like publishing from the listing screen. */
export function saveToCollection(item: BatchItem) {
  const draft = item.auto?.draft;
  if (!draft) return;
  try {
    const entry = itemFromListing(
      { title: draft.title, price: draft.price, barcode: draft.barcode, aspects: draft.aspects, imageUrls: draft.imageUrls },
      item.scanned ?? null,
    );
    collectionStore.saveReviewed(entry);
  } catch {
    // The listing is live; a Collection hiccup shouldn't show as a failure.
  }
}

/** Keeps the phone screen on while the run works (where the browser allows it). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | undefined;
    let cancelled = false;
    (navigator as Navigator & { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
      .request("screen")
      .then((l) => {
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
    };
  }, [on]);
}

/**
 * Runs every ready CD through price, write and publish, two at a time, until
 * none is left. CDs left mid-run by a closed app go back to waiting on load.
 */
export function useAutoRun(hydrated: boolean) {
  const [running, setRunning] = useState(false);
  const active = useRef(new Set<string>());
  const stop = useRef(false);
  useWakeLock(running);

  useEffect(() => {
    if (!hydrated) return;
    const items = autoStore.all();
    if (items.some((x) => interruptedToWaiting(x) !== x)) autoStore.replace(items.map(interruptedToWaiting));
  }, [hydrated]);

  const start = useCallback(async (onlyId?: string) => {
    if (active.current.size && !onlyId) return;
    stop.current = false;
    setRunning(true);
    const next = () =>
      readyForAuto(autoStore.all()).find((x) => !active.current.has(x.id) && (!onlyId || x.id === onlyId));
    const worker = async () => {
      for (let item = next(); item && !stop.current; item = next()) {
        active.current.add(item.id);
        try {
          await listOne(item.id);
        } finally {
          active.current.delete(item.id);
        }
        if (onlyId) break;
      }
    };
    await Promise.all(Array.from({ length: onlyId ? 1 : PARALLEL }, worker));
    if (!active.current.size) setRunning(false);
  }, []);

  /** Lets the CDs already started finish, and starts no more. */
  const pause = useCallback(() => {
    stop.current = true;
  }, []);

  return { running, start, pause };
}
