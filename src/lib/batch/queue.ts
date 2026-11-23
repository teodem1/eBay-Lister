/**
 * "To list": CDs scanned (one at a time or a stack in a row) whose listing
 * isn't finished yet, listed one at a time. Each keeps its progress on the
 * listing screen (grades, photos, price check, Claude's draft) so nothing is
 * lost when the app closes. Pure helpers (no browser APIs) so they are easy to test. Storage
 * lives in ./store.ts.
 *
 * Scanning only looks up the album name (eBay Browse + MusicBrainz, free).
 * Sold prices (sold-comps, 100 calls a month) are checked only when a CD is
 * opened on the listing screen, so a queue costs nothing until it is worked.
 */
import { itemFromLookup, type CollectionItem } from "../collection/collection";
import { listingQuery, type LookupResponse } from "../lookup";
import type { GeneratedListing } from "../listing/types";
import type { SellerCondition } from "../listing/conditionSchema";
import type { PriceCheck } from "../../app/listing/priceRequest";

export type BatchStatus = "pending" | "listed" | "skipped";
export type LookupState = "queued" | "loading" | "done" | "error";

/** Where the seller is on the listing screen, saved as they go. */
export interface ListingProgress {
  query: string;
  barcode: string;
  condition: Partial<SellerCondition>;
  /** Photo URLs, one per line, as the photo step keeps them. */
  imageText: string;
  price?: number;
  priceChosen?: boolean;
  priceCheck?: PriceCheck;
  generated?: GeneratedListing;
  draft?: GeneratedListing["draft"];
  guessed?: string[];
  savedAt: string;
}

export interface BatchItem {
  id: string;
  /** "stack" = scanned on the To list screen; "scan" = opened from the Scan screen. */
  origin?: "stack" | "scan";
  barcode: string;
  addedAt: string;
  status: BatchStatus;
  lookup: LookupState;
  /** Album name (or best eBay title) once the lookup is back. */
  title?: string;
  artist?: string;
  year?: number;
  coverUrl?: string;
  /** What the listing screen starts from (its ?q=). */
  query?: string;
  /** What the scan found, handed to the listing screen for the Collection. */
  scanned?: CollectionItem;
  error?: string;
  /** Disc and inlay grades picked before opening the listing screen. */
  condition?: Partial<SellerCondition>;
  progress?: ListingProgress;
  /** Set once the CD was opened on the listing screen (one sold-price check). */
  openedAt?: string;
  listingId?: string;
  listingUrl?: string;
  doneAt?: string;
}

export type AddResult = { items: BatchItem[]; added: BatchItem } | { items: BatchItem[]; duplicate: BatchItem };

/** Adds a scanned barcode to the end of the queue, unless it is already waiting there. */
export function addCode(items: BatchItem[], barcode: string, now = new Date(), origin: BatchItem["origin"] = "stack"): AddResult {
  // Photo lookups have no barcode, so they never count as repeats.
  const waiting = barcode ? items.find((x) => x.barcode === barcode && x.status === "pending") : undefined;
  if (waiting) return { items, duplicate: waiting };
  const added: BatchItem = {
    id: newId(),
    barcode,
    addedAt: now.toISOString(),
    status: "pending",
    lookup: "queued",
    origin,
  };
  return { items: [...items, added], added };
}

/** Fills in the album name, cover and listing query from a barcode lookup. */
export function applyLookup(item: BatchItem, data: LookupResponse): BatchItem {
  const scanned = itemFromLookup(data) ?? undefined;
  return {
    ...item,
    lookup: "done",
    error: undefined,
    title: scanned?.title,
    artist: scanned?.artist || undefined,
    year: scanned?.year,
    coverUrl: scanned?.coverUrl,
    query: listingQuery(data) || undefined,
    scanned,
  };
}

/**
 * The next items whose album name should be fetched, at most `limit` at once
 * including those already loading. `inFlight` holds ids really being fetched;
 * an item left "loading" by a closed screen is fetched again.
 */
export function lookupsToStart(items: BatchItem[], inFlight: ReadonlySet<string>, limit = 2): BatchItem[] {
  const free = limit - inFlight.size;
  if (free <= 0) return [];
  return items
    .filter((x) => x.status === "pending" && !inFlight.has(x.id) && (x.lookup === "queued" || x.lookup === "loading"))
    .slice(0, free);
}

/** First pending CD after `afterId` (in queue order), else the first pending one. */
export function nextPending(items: BatchItem[], afterId?: string): BatchItem | undefined {
  const pending = items.filter((x) => x.status === "pending");
  if (!afterId) return pending[0];
  const at = items.findIndex((x) => x.id === afterId);
  return pending.find((x) => items.indexOf(x) > at) ?? pending.find((x) => x.id !== afterId);
}

export interface BatchSummary {
  pending: number;
  listed: number;
  skipped: number;
  /** CDs opened on the listing screen, i.e. sold-price checks this batch used. */
  priceChecks: number;
}

export function summarize(items: BatchItem[]): BatchSummary {
  return {
    pending: items.filter((x) => x.status === "pending").length,
    listed: items.filter((x) => x.status === "listed").length,
    skipped: items.filter((x) => x.status === "skipped").length,
    priceChecks: items.filter((x) => x.openedAt).length,
  };
}

/** Listing screen link for a queued CD, with the seller's grades and the queue id. */
export function batchListingHref(item: BatchItem, condition: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (item.query) params.set("q", item.query);
  if (item.barcode) params.set("barcode", item.barcode);
  for (const [k, v] of Object.entries(condition)) params.set(k, v);
  params.set("batch", item.id);
  return `/listing?${params.toString()}`;
}

/** How far the listing got, for the queue row. */
export function progressLabel(item: BatchItem): string | undefined {
  const p = item.progress;
  if (p?.draft) return "Draft written";
  if (p?.imageText.trim()) return "Photos added";
  if (p?.condition.disc || item.condition?.disc) return "Graded";
  return undefined;
}

/** Name to show for a queued CD. */
export function batchItemName(item: BatchItem): string {
  return item.title || item.query || (item.barcode ? `Barcode ${item.barcode}` : "Unknown CD");
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
