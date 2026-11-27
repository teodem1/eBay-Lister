/**
 * The CD collection: pure helpers (no browser APIs) so they are easy to test.
 * Storage lives in ./store.ts.
 */
import type { LookupResponse } from "../lookup";
import type { PriceCheck } from "../pricing/priceCheck";

export interface CollectionItem {
  id: string;
  /** Album name. */
  title: string;
  /** Artist or group. */
  artist: string;
  year?: number;
  coverUrl?: string;
  /** Second cover to try when the first one fails to load (e.g. an eBay photo). */
  fallbackCoverUrl?: string;
  barcode?: string;
  /** Sale price in CAD. */
  price?: number;
  /** "estimate" = median of current eBay listings at scan time; "manual" = set by the user. */
  priceSource?: "estimate" | "manual";
  /** User-assignable categories, e.g. genre or shelf. */
  categories: string[];
  /** The eBay listing's SKU, when the CD was listed from this app (edits are pushed to it). */
  sku?: string;
  /** When the CD sold (YYYY-MM-DD). Set = sold; it then leaves the inventory value. */
  soldAt?: string;
  /** What it sold for, in CAD (optional). */
  soldPrice?: number;
  /** The price check already made for this CD (when it was listed, or from Collection), so its sold prices show for free. */
  priceCheck?: PriceCheck;
  /** When that check was made (ISO). */
  priceCheckedAt?: string;
  addedAt: string;
  updatedAt: string;
}

export const CURRENCY = "CAD";

/** Builds a collection entry from a lookup result, or null if there's nothing to name it by. */
export function itemFromLookup(data: LookupResponse, now = new Date()): CollectionItem | null {
  const album = data.album;
  const id = data.identification;
  const firstEbay = data.results.items[0];
  const title = album?.title || id?.music?.album || id?.title || firstEbay?.title || "";
  if (!title.trim()) return null;
  const artist = album?.artist || id?.music?.artist || id?.brand || "";
  const yearFromId = Number(id?.music?.year);
  const ebayImage = data.results.items.find((i) => i.imageUrl)?.imageUrl;
  const price = estimatePrice(data);
  const stamp = now.toISOString();
  return {
    id: newId(),
    title: title.trim(),
    artist: artist.trim(),
    year: album?.year ?? (Number.isInteger(yearFromId) && yearFromId > 1800 ? yearFromId : undefined),
    coverUrl: album?.coverUrl ?? ebayImage,
    fallbackCoverUrl: album?.coverUrl ? ebayImage : undefined,
    barcode: data.gtin,
    price,
    priceSource: price === undefined ? undefined : "estimate",
    categories: (album?.genres ?? []).map(cleanCategory).filter(Boolean),
    addedAt: stamp,
    updatedAt: stamp,
  };
}

/** Median asking price (CAD) of the current eBay matches, rounded to the cent. */
export function estimatePrice(data: LookupResponse): number | undefined {
  const prices = data.results.items
    .filter((i) => i.price?.currency === CURRENCY)
    .map((i) => Number(i.price!.value))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!prices.length) return undefined;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return Math.round(median * 100) / 100;
}

/** Same CD? Barcode wins; otherwise artist + album name. */
export function sameItem(a: CollectionItem, b: CollectionItem): boolean {
  if (a.barcode && b.barcode) return a.barcode === b.barcode;
  return norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist);
}

/**
 * Adds a scanned item, or refreshes the existing entry for the same CD.
 * A refresh fills in missing details but never overwrites the user's edits
 * (manual price, categories, names they changed). Returns the list and the saved entry.
 */
export function upsert(items: CollectionItem[], incoming: CollectionItem): { items: CollectionItem[]; saved: CollectionItem; isNew: boolean } {
  // A sold copy is history: another copy of the same CD gets its own entry.
  const i = items.findIndex((x) => !isSold(x) && sameItem(x, incoming));
  if (i < 0) return { items: [incoming, ...items], saved: incoming, isNew: true };
  const old = items[i];
  const saved: CollectionItem = {
    ...old,
    year: old.year ?? incoming.year,
    coverUrl: old.coverUrl ?? incoming.coverUrl,
    fallbackCoverUrl: old.fallbackCoverUrl ?? incoming.fallbackCoverUrl,
    barcode: old.barcode ?? incoming.barcode,
    // A fresh estimate replaces an old estimate, never a price the user typed.
    ...(old.priceSource !== "manual" && incoming.price !== undefined
      ? { price: incoming.price, priceSource: "estimate" as const }
      : {}),
    categories: old.categories.length ? old.categories : incoming.categories,
    updatedAt: incoming.updatedAt,
  };
  const next = [...items];
  next.splice(i, 1);
  return { items: [saved, ...next], saved, isNew: false };
}

export function totalValue(items: CollectionItem[]): number {
  return Math.round(items.reduce((sum, i) => sum + (i.price ?? 0), 0) * 100) / 100;
}

export function isSold(item: CollectionItem): boolean {
  return !!item.soldAt;
}

/** What the sold CDs brought in: the sold price, else the price it was listed at. */
export function soldTotal(items: CollectionItem[]): number {
  return Math.round(items.filter(isSold).reduce((sum, i) => sum + (i.soldPrice ?? i.price ?? 0), 0) * 100) / 100;
}

/** Today's date as YYYY-MM-DD in the phone's time zone. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The fields that mark a CD sold (date defaults to today; no price keeps the listed one as the guide). */
export function markSold(soldAt: string, soldPrice?: number): Pick<CollectionItem, "soldAt" | "soldPrice"> {
  return {
    soldAt,
    soldPrice: soldPrice !== undefined && Number.isFinite(soldPrice) && soldPrice >= 0 ? Math.round(soldPrice * 100) / 100 : undefined,
  };
}

export const NOT_SOLD: Pick<CollectionItem, "soldAt" | "soldPrice"> = { soldAt: undefined, soldPrice: undefined };

export type StatusFilter = "unsold" | "sold" | "all";

/** Every category in use, with how many CDs carry it, most used first. */
export function allCategories(items: CollectionItem[]): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    for (const c of item.categories) {
      const key = norm(c);
      const entry = counts.get(key) ?? { name: c, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type SortKey = "recent" | "sold" | "artist" | "title" | "year" | "price";

/**
 * Search matches album, artist, year, barcode and categories (every word must match).
 * `category` keeps only CDs carrying that category; `status` keeps unsold, sold or all CDs.
 */
export function filterItems(
  items: CollectionItem[],
  { query = "", category, sort = "recent", status = "all" }: { query?: string; category?: string; sort?: SortKey; status?: StatusFilter },
): CollectionItem[] {
  const words = norm(query).split(" ").filter(Boolean);
  const out = items.filter((item) => {
    if (status !== "all" && isSold(item) !== (status === "sold")) return false;
    if (category && !item.categories.some((c) => norm(c) === norm(category))) return false;
    const hay = norm([item.title, item.artist, item.year ?? "", item.barcode ?? "", ...item.categories].join(" "));
    return words.every((w) => hay.includes(w));
  });
  const by: Record<SortKey, (a: CollectionItem, b: CollectionItem) => number> = {
    recent: (a, b) => b.addedAt.localeCompare(a.addedAt),
    sold: (a, b) => (b.soldAt ?? "").localeCompare(a.soldAt ?? "") || b.updatedAt.localeCompare(a.updatedAt),
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
    price: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  };
  return out.sort(by[sort]);
}

export function cleanCategory(c: string): string {
  const t = c.trim().replace(/\s+/g, " ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Adds a category unless the item already has it (case-insensitive). */
export function withCategory(categories: string[], c: string): string[] {
  const clean = cleanCategory(c);
  if (!clean || categories.some((x) => norm(x) === norm(clean))) return categories;
  return [...categories, clean];
}

/** Reads a backup file; drops anything that doesn't look like an entry. */
export function parseBackup(json: string): CollectionItem[] {
  const data = JSON.parse(json) as unknown;
  const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new Error("Not a collection backup file.");
  return list
    .filter((x): x is CollectionItem => !!x && typeof x === "object" && typeof (x as CollectionItem).title === "string")
    .map((x) => ({
      ...x,
      id: typeof x.id === "string" ? x.id : newId(),
      artist: typeof x.artist === "string" ? x.artist : "",
      categories: Array.isArray(x.categories) ? x.categories.filter((c) => typeof c === "string") : [],
      soldAt: typeof x.soldAt === "string" && x.soldAt ? x.soldAt : undefined,
      soldPrice: typeof x.soldPrice === "number" && Number.isFinite(x.soldPrice) ? x.soldPrice : undefined,
      addedAt: typeof x.addedAt === "string" ? x.addedAt : new Date().toISOString(),
      updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : new Date().toISOString(),
    }));
}

/** Merges a backup into the current list (existing entries win). */
export function mergeBackup(items: CollectionItem[], imported: CollectionItem[]): CollectionItem[] {
  const out = [...items];
  for (const item of imported) if (!out.some((x) => x.id === item.id || (isSold(x) === isSold(item) && sameItem(x, item)))) out.push(item);
  return out;
}

function norm(s: string | number): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The reviewed listing fields the collection cares about. */
export interface ListingSnapshot {
  title: string;
  /** The listing's SKU, so later Collection edits can update it on eBay. */
  sku?: string;
  price?: number;
  barcode?: string;
  aspects: { name: string; value: string }[];
  imageUrls?: string[];
  /** The price check the listing used, kept on the CD so Collection can show its sold prices without a new lookup. */
  priceCheck?: PriceCheck;
}

/** Most sales or listings kept per list on a saved check (keeps the phone's storage small). */
const KEPT_COMPARABLES = 30;

/** A price check trimmed for saving on a Collection CD: newest sales and cheapest listings first. */
export function trimCheck(check: PriceCheck): PriceCheck {
  return {
    ...check,
    soldItems: [...check.soldItems].sort((a, b) => (b.soldDate ?? "").localeCompare(a.soldDate ?? "")).slice(0, KEPT_COMPARABLES),
    currentItems: [...check.currentItems].sort((a, b) => a.price.value - b.price.value).slice(0, KEPT_COMPARABLES),
  };
}

// Item specifics names eBay uses for music, in English and French.
const ASPECT_NAMES = {
  artist: ["artist", "artiste", "band", "groupe"],
  album: ["release title", "album", "album name", "titre", "titre de l'album"],
  year: ["release year", "year", "année", "annee", "année de sortie"],
  genre: ["genre", "style"],
} as const;

function aspect(aspects: ListingSnapshot["aspects"], key: keyof typeof ASPECT_NAMES): string {
  const names: readonly string[] = ASPECT_NAMES[key];
  return aspects.find((a) => names.includes(a.name.trim().toLowerCase()) && a.value.trim())?.value.trim() ?? "";
}

/**
 * The collection entry for a CD whose listing the user reviewed. The listing's
 * item specifics and price win (the user checked them); details from the scan
 * (cover, MusicBrainz names) fill the gaps.
 */
export function itemFromListing(listing: ListingSnapshot, scanned: CollectionItem | null, now = new Date()): CollectionItem {
  const year = Number(aspect(listing.aspects, "year").slice(0, 4));
  const genres = aspect(listing.aspects, "genre")
    .split(/[,/|]/)
    .map(cleanCategory)
    .filter(Boolean);
  const stamp = now.toISOString();
  const price = listing.price && listing.price > 0 ? Math.round(listing.price * 100) / 100 : undefined;
  const photo = listing.imageUrls?.find(Boolean);
  return {
    id: scanned?.id ?? newId(),
    title: aspect(listing.aspects, "album") || scanned?.title || listing.title,
    artist: aspect(listing.aspects, "artist") || scanned?.artist || "",
    year: Number.isInteger(year) && year > 1800 ? year : scanned?.year,
    coverUrl: scanned?.coverUrl ?? photo,
    fallbackCoverUrl: scanned?.coverUrl ? (photo ?? scanned.fallbackCoverUrl) : undefined,
    barcode: listing.barcode || scanned?.barcode,
    sku: listing.sku || scanned?.sku,
    price: price ?? scanned?.price,
    priceSource: price !== undefined ? "manual" : scanned?.priceSource,
    categories: genres.reduce(withCategory, scanned?.categories ?? []),
    ...(listing.priceCheck ? { priceCheck: trimCheck(listing.priceCheck), priceCheckedAt: stamp } : {}),
    addedAt: scanned?.addedAt ?? stamp,
    updatedAt: stamp,
  };
}

/**
 * Saves a reviewed CD: a new entry, or the existing one for the same CD with the
 * listing's details (they are newer than anything saved before).
 */
export function saveReviewed(items: CollectionItem[], item: CollectionItem): { items: CollectionItem[]; isNew: boolean } {
  const i = items.findIndex((x) => !isSold(x) && sameItem(x, item));
  if (i < 0) return { items: [item, ...items], isNew: true };
  const old = items[i];
  const merged: CollectionItem = {
    ...old,
    ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && v !== "")),
    id: old.id,
    addedAt: old.addedAt,
    categories: item.categories.reduce(withCategory, old.categories),
  };
  const next = [...items];
  next[i] = merged;
  return { items: next, isNew: false };
}
