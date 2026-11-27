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
import type { PriceCheck } from "../pricing/priceCheck";
import type { SortCd } from "../sort/worth";
import type { DiscogsReference } from "../pricing/discogs";

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
  /** A price check already made (e.g. when sorting a pile photo), reused by the listing screen. */
  priceCheck?: PriceCheck;
  progress?: ListingProgress;
  /** Set once the CD was opened on the listing screen (one sold-price check). */
  openedAt?: string;
  listingId?: string;
  listingUrl?: string;
  doneAt?: string;
  /** Only on the Auto tab: photos, the automatic price, and what was published. */
  auto?: AutoState;
}

export type AutoStage = "waiting" | "identifying" | "pricing" | "writing" | "publishing" | "published" | "failed";

/** An Auto tab CD's run: one photo, a price from the sold-price check, Claude's draft, the publish. */
export interface AutoState {
  stage: AutoStage;
  /** eBay-hosted photo URLs, main photo first. */
  photos: string[];
  /** Kept so a retry never spends a second sold-price check. */
  priceCheck?: PriceCheck;
  price?: number;
  /** How the price was picked, e.g. "Median of 6 sold". */
  priceBasis?: string;
  /** The listing as it is on eBay (after any edits). */
  draft?: ListingDraftLike;
  error?: string;
  promotedPercent?: number;
  promotionError?: string;
  revisedAt?: string;
  /** Discogs price guide, checked for CDs worth more than a usual CD (or with no eBay copies). */
  discogs?: DiscogsReference | null;
  /** Why there's no Discogs reference, when one was asked for. */
  discogsNote?: string;
  /** Set once Claude tried to name the album from the front cover (barcode unknown to eBay and MusicBrainz). */
  coverChecked?: boolean;
  /** How many times the run tried this CD, and when it last failed. */
  tries?: number;
  failedAt?: string;
  /** The last failure came back with the same message as the one before it. */
  sameAgain?: boolean;
  lastError?: string;
}

/** The published draft (same shape as ListingDraft, kept loose to avoid importing zod here). */
export type ListingDraftLike = GeneratedListing["draft"] & { price: number };

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

/** A CD picked from a pile photo ("Sort a pile"), with its price check, ready to list. */
export function itemFromSort(
  cd: Pick<SortCd, "artist" | "album" | "year" | "barcode" | "check"> & { keywords: string; coverUrl?: string },
  now = new Date(),
): BatchItem {
  const year = Number(cd.year);
  return {
    id: newId(),
    origin: "stack",
    barcode: cd.barcode,
    addedAt: now.toISOString(),
    status: "pending",
    lookup: "done",
    title: cd.album || cd.keywords,
    artist: cd.artist || undefined,
    year: Number.isInteger(year) && year > 1900 ? year : undefined,
    coverUrl: cd.coverUrl,
    query: cd.keywords,
    // A check that came back without sold prices (allowance used up) isn't kept: listing it gets a full one.
    priceCheck: cd.check?.soldLimitReached ? undefined : cd.check,
  };
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

/** Whether the seller already did work on this CD on the scan card (photos or grades). */
export function hasScanWork(item: BatchItem): boolean {
  return (item.auto?.photos.length ?? 0) > 0 || Object.values(item.condition ?? {}).some((v) => v !== undefined && v !== "");
}

/** The same CD with a new barcode: the album is looked up again; photos, grades and the Auto run's photos stay. */
export function withNewBarcode(item: BatchItem, gtin: string): BatchItem {
  const same = gtin === item.barcode;
  return {
    ...item,
    barcode: gtin,
    lookup: "queued",
    error: undefined,
    title: undefined,
    artist: undefined,
    year: undefined,
    coverUrl: undefined,
    query: undefined,
    scanned: undefined,
    priceCheck: same ? item.priceCheck : undefined,
    ...(item.auto
      ? {
          auto: {
            ...item.auto,
            stage: "waiting" as const,
            coverChecked: undefined,
            priceCheck: same ? item.auto.priceCheck : undefined,
            discogs: same ? item.auto.discogs : undefined,
            discogsNote: same ? item.auto.discogsNote : undefined,
          },
        }
      : {}),
  };
}

/**
 * "Try again" on the scan card, once the new barcode is in. The CD scanned
 * first never loses the photos and grades taken after it:
 * - with photos or grades, it takes the new barcode in place (same entry, so a
 *   photo still uploading lands on it too), unless the new barcode is another CD
 *   already in the pile: then the work moves there if that CD has none, else both stay;
 * - with nothing on it, it is dropped and the new barcode added as usual.
 * Returns the new list, the CD to show, and whether it counts as newly added.
 */
export function retryScan(
  items: BatchItem[],
  firstId: string,
  gtin: string,
  now = new Date(),
): { items: BatchItem[]; id: string; isNew: boolean } {
  const first = items.find((x) => x.id === firstId);
  if (first && first.barcode === gtin) return { items, id: first.id, isNew: true };
  const other = items.find((x) => x.id !== firstId && x.barcode === gtin && x.status === "pending");
  if (first && hasScanWork(first)) {
    if (!other) {
      return { items: items.map((x) => (x.id === firstId ? withNewBarcode(x, gtin) : x)), id: firstId, isNew: true };
    }
    if (hasScanWork(other)) return { items, id: other.id, isNew: false };
    const moved: BatchItem = {
      ...other,
      condition: first.condition,
      ...(first.auto ? { auto: { ...(other.auto ?? { stage: "waiting" as const }), photos: first.auto.photos } } : {}),
    };
    return { items: items.filter((x) => x.id !== firstId).map((x) => (x.id === other.id ? moved : x)), id: other.id, isNew: false };
  }
  const rest = items.filter((x) => x.id !== firstId);
  const result = addCode(rest, gtin, now);
  return "added" in result
    ? { items: result.items, id: result.added.id, isNew: true }
    : { items: rest, id: result.duplicate.id, isNew: false };
}
