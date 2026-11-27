"use client";

import type { CollectionItem } from "@/lib/collection/collection";
import { collectionStore } from "@/lib/collection/store";
import { autoStore } from "@/lib/batch/store";
import { liveChangeForSku } from "@/lib/auto/auto";

export type EbaySync =
  | { state: "working" }
  | { state: "done" | "not_found" | "failed"; message: string };

type Fields = { title: string; artist: string; year?: number; price?: number };

/**
 * Sends a Collection edit to /api/listing/update-details so the CD's live eBay
 * listing gets the same album, artist, year and price. Never throws.
 */
export async function pushEditToEbay(item: CollectionItem, after: Fields): Promise<EbaySync> {
  try {
    const res = await fetch("/api/listing/update-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: item.sku,
        barcode: item.barcode,
        before: { title: item.title, artist: item.artist, year: item.year, price: item.price },
        after,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { state: "failed", message: `Saved here, but eBay wasn't updated: ${data?.error ?? `error ${res.status}`}` };
    if (data.status === "not_found") return { state: "not_found", message: `Saved here. ${data.reason}` };
    // Remember the listing found by barcode, and keep the Review tab's copy in step
    // (its "Edit" re-sends the whole draft, so it must hold what eBay now has).
    if (data.sku && data.sku !== item.sku) collectionStore.update(item.id, { sku: data.sku });
    if (data.status === "updated" && data.sku) {
      const change = { title: data.title, aspects: data.aspects, price: after.price };
      for (const { id, item: next } of liveChangeForSku(autoStore.all(), data.sku, change)) autoStore.update(id, () => next);
    }
    return {
      state: "done",
      message: data.status === "updated" ? "Saved and updated on eBay." : "Saved. The eBay listing already matched.",
    };
  } catch (e) {
    return { state: "failed", message: `Saved here, but eBay wasn't updated: ${(e as Error).message}` };
  }
}
