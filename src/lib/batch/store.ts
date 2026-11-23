"use client";
/**
 * Saves the batch queue on this device (localStorage), like the Collection,
 * so a stack scanned tonight can be listed tomorrow.
 */
import { useSyncExternalStore } from "react";
import type { LookupResponse } from "../lookup";
import type { SellerCondition } from "../listing/conditionSchema";
import { addCode, applyLookup, type BatchItem } from "./queue";

const EMPTY: BatchItem[] = [];

/** A list of scanned CDs saved on this device under `key`, kept in sync across screens. */
export function createBatchStore(key: string) {
  const listeners = new Set<() => void>();
  let cache: BatchItem[] | null = null;

  function read(): BatchItem[] {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(key);
      cache = raw ? (JSON.parse(raw) as BatchItem[]) : [];
    } catch {
      cache = [];
    }
    return cache;
  }

  function write(items: BatchItem[]) {
    cache = items;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Storage full or blocked: keep the in-memory copy for this session.
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cache = null;
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return {
    /** The list, kept in sync across screens. Empty during server render. */
    useItems: () => useSyncExternalStore(subscribe, read, () => EMPTY),
    all: read,
    get(id: string) {
      return read().find((x) => x.id === id);
    },
    add(barcode: string) {
      const result = addCode(read(), barcode);
      if ("added" in result) write(result.items);
      return result;
    },
    /**
     * A CD opened from the Scan screen joins the list too, so an unfinished
     * listing can be picked up later. Scanning a CD that is already waiting
     * reuses its entry (and its saved progress).
     */
    fromScan(data: LookupResponse, condition: Partial<SellerCondition>): BatchItem {
      const result = addCode(read(), data.gtin ?? "", new Date(), "scan");
      const base = "added" in result ? result.added : result.duplicate;
      const item: BatchItem = { ...applyLookup(base, data), condition, progress: base.progress };
      const exists = read().some((x) => x.id === item.id);
      write(exists ? read().map((x) => (x.id === item.id ? item : x)) : [...read(), item]);
      return item;
    },
    /** Adds a whole entry (e.g. a CD moved over from the Auto tab). */
    put(item: BatchItem) {
      const exists = read().some((x) => x.id === item.id);
      write(exists ? read().map((x) => (x.id === item.id ? item : x)) : [...read(), item]);
    },
    update(id: string, patch: Partial<BatchItem> | ((item: BatchItem) => BatchItem)) {
      write(read().map((x) => (x.id === id ? (typeof patch === "function" ? patch(x) : { ...x, ...patch }) : x)));
    },
    remove(id: string) {
      write(read().filter((x) => x.id !== id));
    },
    /** Drops the CDs already listed or skipped. */
    clearDone() {
      write(read().filter((x) => x.status === "pending"));
    },
    replace: write,
  };
}

export type BatchStore = ReturnType<typeof createBatchStore>;

/** "To list": CDs listed by hand on the listing screen. */
export const batchStore = createBatchStore("ebay-lister:batch:v1");
/** "Auto": CDs the app prices, writes and publishes on its own. */
export const autoStore = createBatchStore("ebay-lister:auto:v1");

/** The To list queue, kept in sync across screens. Empty during server render. */
export function useBatch(): BatchItem[] {
  return batchStore.useItems();
}

/** The Auto list. */
export function useAuto(): BatchItem[] {
  return autoStore.useItems();
}
