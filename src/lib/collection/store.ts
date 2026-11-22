"use client";
/**
 * Saves the collection on this device (localStorage). In the Android app this
 * is the app's WebView storage: it survives app updates but not an uninstall
 * or "Clear data", so the Collection screen offers a backup file.
 */
import { useSyncExternalStore } from "react";
import { saveReviewed, type CollectionItem } from "./collection";

const KEY = "ebay-lister:collection:v1";
// What the scan found, waiting for the listing screen to save it with the reviewed details.
const PENDING_KEY = "ebay-lister:collection:pending";
const EMPTY: CollectionItem[] = [];
const listeners = new Set<() => void>();
let cache: CollectionItem[] | null = null;

function read(): CollectionItem[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CollectionItem[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CollectionItem[]) {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
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

/** The saved CDs, kept in sync across screens and tabs. Empty during server render. */
export function useCollection(): CollectionItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const collectionStore = {
  all: read,
  replace: write,
  /** Saves a CD from the listing screen (or refreshes its entry). */
  saveReviewed(item: CollectionItem) {
    const result = saveReviewed(read(), item);
    write(result.items);
    return result;
  },
  update(id: string, patch: Partial<CollectionItem>) {
    write(read().map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)));
  },
  remove(id: string) {
    write(read().filter((x) => x.id !== id));
  },
  /** Puts back an entry exactly as it was (for Undo). */
  restore(previous: CollectionItem[]) {
    write(previous);
  },
};

/** Keeps what the scan found until the listing screen saves it (this tab only). */
export function stashScanned(item: (CollectionItem & { query?: string }) | null) {
  try {
    if (item) sessionStorage.setItem(PENDING_KEY, JSON.stringify(item));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: the listing screen falls back to the listing's own details.
  }
}

/** The scanned CD for this listing, if the scan was for the same barcode or search. */
export function readScanned(barcode: string, query: string): CollectionItem | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const item = JSON.parse(raw) as CollectionItem & { query?: string };
    if (barcode && item.barcode) return item.barcode === barcode ? item : null;
    return !item.query || item.query === query ? item : null;
  } catch {
    return null;
  }
}
