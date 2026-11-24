/**
 * The sold-comps.com allowance (100 sold-price lookups a month on the free
 * plan), as last seen by a price check on this phone. Saved in localStorage so
 * every tab can warn the seller: when it is used up, and when only a few
 * lookups are left (if sold-comps.com says how many).
 */
import { useSyncExternalStore } from "react";

const KEY = "ebay-lister:sold-quota:v1";
/** Warn when this many lookups or fewer are left. */
export const SOLD_LOW_AT = 10;
/** A "used up" mark older than this is dropped (the allowance is monthly). */
const LIMIT_TTL_MS = 31 * 24 * 3600 * 1000;

export interface SoldQuota {
  /** When a price check found the allowance used up (ISO). */
  limitAt?: string;
  /** Lookups left, from the last answer that said so. */
  remaining?: number;
}

export type SoldQuotaWarning = { kind: "limit" } | { kind: "low"; remaining: number } | null;

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: SoldQuota } = { raw: null, value: {} };

function read(): SoldQuota {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === cache.raw) return cache.value;
  let value: SoldQuota = {};
  try {
    value = raw ? (JSON.parse(raw) as SoldQuota) : {};
  } catch {
    value = {};
  }
  cache = { raw, value };
  return value;
}

function write(q: SoldQuota) {
  try {
    if (typeof localStorage === "undefined") return;
    if (q.limitAt === undefined && q.remaining === undefined) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Private mode or storage full: the warning just won't persist.
  }
  listeners.forEach((l) => l());
}

/** The next quota state after a price-suggestion answer. Pure, for tests. */
export function nextSoldQuota(
  prev: SoldQuota,
  data: { soldLimitReached?: boolean; soldRemaining?: number; sold?: unknown },
  now = new Date(),
): SoldQuota {
  if (data.soldLimitReached) return { limitAt: now.toISOString(), remaining: 0 };
  const next: SoldQuota = { ...prev };
  // Sold prices came back: the allowance is not used up (any more).
  if (data.sold) delete next.limitAt;
  if (typeof data.soldRemaining === "number") next.remaining = data.soldRemaining;
  else if (data.sold && next.remaining === 0) delete next.remaining;
  return next;
}

/** What to warn about, if anything. */
export function soldQuotaWarning(q: SoldQuota, now?: Date): SoldQuotaWarning {
  // The clock is only read when there is a mark to age (never while prerendering).
  if (q.limitAt && (now ?? new Date()).getTime() - Date.parse(q.limitAt) < LIMIT_TTL_MS) return { kind: "limit" };
  if (typeof q.remaining === "number" && q.remaining <= SOLD_LOW_AT && !q.limitAt) {
    return q.remaining === 0 ? { kind: "limit" } : { kind: "low", remaining: q.remaining };
  }
  return null;
}

/** Records what a /api/price-suggestion answer says about the allowance. */
export function noteSoldQuota(data: unknown) {
  if (!data || typeof data !== "object") return;
  const prev = read();
  const next = nextSoldQuota(prev, data as Parameters<typeof nextSoldQuota>[1]);
  if (JSON.stringify(next) !== JSON.stringify(prev)) write(next);
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** The current warning, for screens. Null on the server. */
export function useSoldQuotaWarning(): SoldQuotaWarning {
  const q = useSyncExternalStore(subscribe, read, () => ({}) as SoldQuota);
  return soldQuotaWarning(q);
}
