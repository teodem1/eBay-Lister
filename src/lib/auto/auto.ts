/**
 * "Auto" tab: the seller scans a stack, grades each CD and takes one photo;
 * the app then prices, writes and publishes each one with no review screen.
 * Pure helpers (no browser APIs) so they are easy to test. The run itself
 * lives in src/app/auto/useAutoRun.ts.
 */
import type { BatchItem, AutoState, ListingDraftLike } from "../batch/queue";
import { conditionComplete } from "../listing/condition";
import type { GeneratedListing } from "../listing/types";
import type { PriceCheck } from "../../app/listing/priceRequest";

/** eBay.ca Music > CDs, used when the category search came back empty. */
export const CD_CATEGORY_ID = "176984";

/** At most this many photos per CD on the Auto tab (one is enough). */
export const AUTO_MAX_PHOTOS = 4;

export function autoState(item: BatchItem): AutoState {
  return item.auto ?? { stage: "waiting", photos: [] };
}

/** What still stops a CD from being listed automatically, or null when it is ready. */
export function missingForAuto(item: BatchItem): string | null {
  if (item.lookup === "queued" || item.lookup === "loading") return "Finding the album";
  if (item.lookup === "error" || !item.query) return "Album not found";
  if (!conditionComplete(item.condition ?? {})) return "Grade it";
  if (!autoState(item).photos.length) return "Take a photo";
  return null;
}

/** CDs the run should list now: pending, complete and waiting (a failed one waits for "Try again"). */
export function readyForAuto(items: BatchItem[]): BatchItem[] {
  return items.filter((x) => x.status === "pending" && autoState(x).stage === "waiting" && missingForAuto(x) === null);
}

/**
 * A CD left mid-run when the app closed goes back to waiting. What it already
 * has (price check, draft) is kept, so a retry costs no second sold-price
 * check and re-sends the same SKU instead of making a second listing.
 */
export function interruptedToWaiting(item: BatchItem): BatchItem {
  const a = item.auto;
  if (!a || !["pricing", "writing", "publishing"].includes(a.stage)) return item;
  return { ...item, auto: { ...a, stage: "waiting" } };
}

/**
 * The price to list at: last-sold recommended when there were sales, else the
 * current listings' price. Null when neither found any copy, so nothing is
 * published at a made-up price.
 */
export function pickAutoPrice(check: PriceCheck): { price: number; basis: string } | null {
  const sold = check.sold && check.sold.usedCount > 0 ? check.sold : null;
  if (sold) {
    const n = sold.usedCount;
    return { price: sold.itemPrice.recommended, basis: `From ${n} sold ${n === 1 ? "copy" : "copies"} (${sold.confidence} confidence)` };
  }
  const current = check.current && check.current.usedCount > 0 ? check.current : null;
  if (current) {
    const n = current.usedCount;
    return {
      price: current.itemPrice.recommended,
      basis: `No sales found: from ${n} current ${n === 1 ? "listing" : "listings"} (${current.confidence} confidence)`,
    };
  }
  return null;
}

/** Claude's draft with the automatic price and the seller's photos, ready for /api/listing/publish. */
export function autoDraft(generated: GeneratedListing, price: number, photos: string[]): ListingDraftLike {
  const d = generated.draft;
  return {
    ...d,
    price,
    imageUrls: photos,
    categoryId: d.categoryId || CD_CATEGORY_ID,
    categoryName: d.categoryId ? d.categoryName : (d.categoryName ?? "Music > CDs"),
  };
}

/**
 * Moves a CD that couldn't be listed automatically over to the To list tab,
 * with its grades, photos and price check, so it can be listed by hand.
 */
export function toListEntry(item: BatchItem, now = new Date()): BatchItem {
  const a = autoState(item);
  return {
    ...item,
    origin: "stack",
    status: "pending",
    auto: undefined,
    progress: {
      query: item.query ?? "",
      barcode: item.barcode,
      condition: item.condition ?? {},
      imageText: a.photos.join("\n"),
      price: a.price,
      priceCheck: a.priceCheck,
      savedAt: now.toISOString(),
    },
  };
}

export interface AutoSummary {
  waiting: number;
  ready: number;
  running: number;
  published: number;
  failed: number;
}

export function autoSummary(items: BatchItem[]): AutoSummary {
  const stage = (x: BatchItem) => autoState(x).stage;
  return {
    waiting: items.filter((x) => x.status === "pending" && stage(x) === "waiting").length,
    ready: readyForAuto(items).length,
    running: items.filter((x) => ["pricing", "writing", "publishing"].includes(stage(x))).length,
    published: items.filter((x) => stage(x) === "published").length,
    failed: items.filter((x) => x.status === "pending" && stage(x) === "failed").length,
  };
}

/** Short label for a CD's progress in the run. */
export function stageLabel(stage: AutoState["stage"]): string {
  switch (stage) {
    case "pricing":
      return "Checking sold prices…";
    case "writing":
      return "Claude is writing…";
    case "publishing":
      return "Publishing…";
    case "published":
      return "Published";
    case "failed":
      return "Not listed";
    default:
      return "Waiting";
  }
}
