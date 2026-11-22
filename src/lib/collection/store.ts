"use client";
/**
 * Saves the collection on this device (localStorage). In the Android app this
 * is the app's WebView storage: it survives app updates but not an uninstall
 * or "Clear data", so the Collection screen offers a backup file.
 */
import { useSyncExternalStore } from "react";
import { upsert, type CollectionItem } from "./collection";

const KEY = "ebay-lister:collection:v1";
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
  /** Saves a scanned CD (or refreshes its entry). */
  save(item: CollectionItem) {
    const result = upsert(read(), item);
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
