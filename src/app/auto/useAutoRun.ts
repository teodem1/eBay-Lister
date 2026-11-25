"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCoverName,
  autoDraft,
  autoState,
  discogsCad,
  finalAutoPrice,
  interruptedToWaiting,
  needsCoverName,
  noCopiesMessage,
  pickAutoPrice,
  priceEvidence,
  priceGrade,
  readyForAuto,
  wantsDiscogs,
} from "@/lib/auto/auto";
import type { DiscogsReference } from "@/lib/pricing/discogs";
import type { AutoState, BatchItem } from "@/lib/batch/queue";
import { autoStore } from "@/lib/batch/store";
import { itemFromListing } from "@/lib/collection/collection";
import { collectionStore } from "@/lib/collection/store";
import type { GeneratedListing } from "@/lib/listing/types";
import type { LookupResponse } from "@/lib/lookup";
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

/** Claude's reading of the front cover photo, or null when it couldn't be read. */
async function nameFromCover(imageUrl: string, barcode: string): Promise<LookupResponse | null> {
  try {
    const res = await fetch("/api/lookup/cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, barcode }),
    });
    return res.ok ? ((await res.json()) as LookupResponse) : null;
  } catch {
    return null;
  }
}

/** A CD (e.g. a retry) that fails right away still shows its spinner for a moment, so the tap visibly did something. */
const MIN_RETRY_MS = 900;

/** Price check, Claude's listing and the publish for one CD. Never throws: failures are saved on the CD. */
async function listOne(id: string): Promise<void> {
  const began = Date.now();
  const first = autoStore.get(id);
  if (!first) return;
  const before = first.auto?.lastError ?? first.auto?.error;
  try {
    // 0. The barcode named no album: read it off the front cover, so prices are searched by name.
    if (needsCoverName(first)) {
      patchAuto(id, { stage: "identifying", error: undefined });
      const named = await nameFromCover(autoState(first).photos[0], first.barcode);
      autoStore.update(id, (x) => applyCoverName(x, named));
    }
    const start = autoStore.get(id)!;
    const query = start.query ?? "";
    const condition = start.condition!;
    // 1. Sold prices: one sold-comps call per CD, saved so a retry doesn't spend another.
    patchAuto(id, { stage: "pricing", error: undefined });
    let check = autoState(start).priceCheck;
    if (!check) {
      const body = priceSuggestionBody(query, start.barcode, condition.condition);
      if (!body) throw new Error("Nothing to search prices for.");
      autoStore.update(id, (x) => ({ ...x, openedAt: x.openedAt ?? new Date().toISOString() }));
      const result = await fetchPriceSuggestion(body);
      if ("error" in result) throw new Error(`Price check failed: ${result.error}`);
      check = result;
      patchAuto(id, { priceCheck: check });
    }
    // Worth more than a usual CD, or no eBay copies at all: ask the Discogs price guide too (asked once per CD).
    let discogs = autoState(autoStore.get(id)!).discogs;
    if (discogs === undefined && wantsDiscogs(check) && start.barcode) {
      const ref = await fetch("/api/price-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: start.barcode }),
      })
        .then((r) => r.json())
        .catch(() => ({ discogs: null, unavailable: "Discogs lookup failed." }));
      discogs = (ref?.discogs as DiscogsReference | null) ?? null;
      patchAuto(id, { discogs, discogsNote: ref?.unavailable });
    }
    const grade = priceGrade(condition);
    const discogsPrice = discogsCad(discogs, grade);
    const ebayPrice = pickAutoPrice(check);
    // Nothing sold or listed anywhere: no basis for a price, so this CD is not listed automatically.
    if (!ebayPrice && discogsPrice === undefined) {
      throw new Error(noCopiesMessage(autoStore.get(id)!));
    }

    // 2. Claude writes the listing and picks the price from the sold and listed copies
    //    (kept if a later step failed, so the same SKU is re-sent).
    let draft = autoState(autoStore.get(id)!).draft;
    const photos = autoState(autoStore.get(id)!).photos;
    if (!draft) {
      patchAuto(id, { stage: "writing", error: undefined });
      const generated = await postJson<GeneratedListing>("/api/listing/generate", {
        query,
        barcode: start.barcode || undefined,
        suggestedPrice: ebayPrice?.price ?? discogsPrice,
        sellerCondition: condition,
        priceEvidence: priceEvidence(check, 15, discogs ? { ref: discogs, grade } : undefined),
      });
      const picked = finalAutoPrice(check, generated.claudePrice, discogsPrice)!;
      draft = autoDraft(generated, picked.price, photos);
      patchAuto(id, { draft, price: picked.price, priceBasis: picked.basis });
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
    const wait = MIN_RETRY_MS - (Date.now() - began);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    autoStore.update(id, (x) => {
      const a = autoState(x);
      const error = (e as Error).message;
      return {
        ...x,
        auto: {
          ...a,
          stage: "failed",
          error,
          lastError: error,
          sameAgain: before === error,
          tries: (a.tries ?? 0) + 1,
          failedAt: new Date().toISOString(),
        },
      };
    });
  }
}

/** Adds (or updates) the published CD in the Collection, like publishing from the listing screen. */
export function saveToCollection(item: BatchItem) {
  const draft = item.auto?.draft;
  if (!draft) return;
  try {
    const entry = itemFromListing(
      { title: draft.title, sku: draft.sku, price: draft.price, barcode: draft.barcode, aspects: draft.aspects, imageUrls: draft.imageUrls },
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
export function useAutoRun(hydrated: boolean, held: { current: ReadonlySet<string> }) {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
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
    setPaused(false);
    setRunning(true);
    // A CD the seller is still photographing or grading waits until they move on.
    const next = () =>
      readyForAuto(autoStore.all()).find(
        (x) => !active.current.has(x.id) && (onlyId ? x.id === onlyId : !held.current.has(x.id)),
      );
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
  }, [held]);

  /** Lets the CDs already started finish, and starts no more until resumed. */
  const pause = useCallback(() => {
    stop.current = true;
    setPaused(true);
  }, []);

  return { running, paused, start, pause };
}
