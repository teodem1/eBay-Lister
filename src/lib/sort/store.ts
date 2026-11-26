"use client";
/**
 * Saves the last pile photo's CDs and every price check it made on this
 * phone (localStorage), so reopening the screen or photographing the same CD
 * again never spends a second sold-price lookup.
 */
import { useSyncExternalStore } from "react";
import type { PriceCheck } from "../../app/listing/priceRequest";
import type { SortCd, SortSession } from "./worth";

const SESSION_KEY = "ebay-lister:sort:v1";
const CACHE_KEY = "ebay-lister:sort-cache:v1";
const MIN_NET_KEY = "ebay-lister:sort-min-net:v1";
/** Sold prices a month old are still a fair guide for sorting a pile. */
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

type Cache = Record<string, { at: string; check: PriceCheck }>;

const listeners = new Set<() => void>();
let session: SortSession | null | undefined;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: keep the in-memory copy for this session.
  }
}

function readSession(): SortSession | null {
  if (session === undefined) session = readJson<SortSession | null>(SESSION_KEY, null);
  return session;
}

function setSession(next: SortSession | null) {
  session = next;
  writeJson(SESSION_KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const sortStore = {
  useSession: () => useSyncExternalStore(subscribe, readSession, () => null),
  get: readSession,
  start: (s: SortSession) => setSession(s),
  clear: () => setSession(null),
  updateCd(id: string, patch: Partial<SortCd>) {
    const s = readSession();
    if (s) setSession({ ...s, cds: s.cds.map((cd) => (cd.id === id ? { ...cd, ...patch } : cd)) });
  },
  updateAll(patch: (cd: SortCd) => Partial<SortCd>) {
    const s = readSession();
    if (s) setSession({ ...s, cds: s.cds.map((cd) => ({ ...cd, ...patch(cd) })) });
  },
};

export const priceCache = {
  get(key: string, now = Date.now()): PriceCheck | undefined {
    return priceCache.entry(key, now)?.check;
  },
  /** The cached check and when it was made (ISO), within the 30 days. */
  entry(key: string, now = Date.now()): { at: string; check: PriceCheck } | undefined {
    const hit = readJson<Cache>(CACHE_KEY, {})[key];
    return hit && now - Date.parse(hit.at) < CACHE_TTL_MS ? hit : undefined;
  },
  put(key: string, check: PriceCheck, now = new Date()) {
    const cache = readJson<Cache>(CACHE_KEY, {});
    // Drop old entries so the cache stays small.
    for (const [k, v] of Object.entries(cache)) if (now.getTime() - Date.parse(v.at) >= CACHE_TTL_MS) delete cache[k];
    cache[key] = { at: now.toISOString(), check };
    writeJson(CACHE_KEY, cache);
  },
};

export function readMinNet(fallback: number): number {
  const n = readJson<number | null>(MIN_NET_KEY, null);
  return typeof n === "number" && n >= 0 ? n : fallback;
}

export function saveMinNet(n: number) {
  writeJson(MIN_NET_KEY, n);
}
