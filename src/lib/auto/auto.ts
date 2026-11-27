/**
 * "Auto" tab: the seller scans a stack, grades each CD and takes one photo;
 * the app then prices, writes and publishes each one with no review screen.
 * Pure helpers (no browser APIs) so they are easy to test. The run itself
 * lives in src/app/auto/useAutoRun.ts.
 */
import type { EditionPrice } from "../pricing/edition";
import { applyLookup, type BatchItem, type AutoState, type ListingDraftLike } from "../batch/queue";
import type { LookupResponse } from "../lookup";
import { conditionComplete, GRADES, type Grade, type SellerCondition } from "../listing/condition";
import { discogsEvidence, discogsPriceFor, type DiscogsReference } from "../pricing/discogs";
import type { GeneratedListing } from "../listing/types";
import type { PriceCheck } from "../pricing/priceCheck";

/** eBay.ca Music > CDs, used when the category search came back empty. */
export const CD_CATEGORY_ID = "176984";

/** Photos asked for after each scan, in order: the front cover is the main photo. */
export const AUTO_PHOTOS = ["Front cover", "Back cover"] as const;
/**
 * A CD whose eBay price is at least this (CAD) counts as collectible: its price
 * is also checked against the Discogs price guide.
 */
export const COLLECTIBLE_MIN_CAD = 25;

/** The grade that sets the price: the worse of disc and inlay (a missing inlay counts as Good); sealed = Mint. */
export function priceGrade(sc: Partial<SellerCondition> | undefined): Grade | undefined {
  if (!sc) return undefined;
  if (sc.condition === "NEW") return "Mint";
  const inlay: Grade | undefined = sc.booklet === "Missing" ? "Good" : sc.booklet;
  const parts = [sc.disc, inlay].filter(Boolean) as Grade[];
  return parts.sort((a, b) => GRADES.indexOf(b) - GRADES.indexOf(a))[0];
}

/** Whether to ask Discogs too: the eBay price says it's worth more than a usual CD, or eBay found no copies. */
export function wantsDiscogs(check: PriceCheck): boolean {
  const ebay = pickAutoPrice(check);
  return !ebay || ebay.price >= COLLECTIBLE_MIN_CAD;
}

/** Discogs' price for the grade, when it is in CAD (other currencies aren't converted). */
export function discogsCad(ref: DiscogsReference | null | undefined, grade: Grade | undefined): number | undefined {
  if (!ref || (ref.suggestionCurrency && ref.suggestionCurrency !== "CAD")) return undefined;
  return discogsPriceFor(ref, grade);
}

/** At most this many photos per CD on the Auto tab (eBay allows 24). */
export const AUTO_MAX_PHOTOS = 12;

/** Stages while the run is working on a CD. */
export const BUSY_STAGES: AutoState["stage"][] = ["identifying", "pricing", "writing", "publishing"];

export function autoState(item: BatchItem): AutoState {
  return item.auto ?? { stage: "waiting", photos: [] };
}

/** What still stops a CD from being listed automatically, or null when it is ready. */
export function missingForAuto(item: BatchItem): string | null {
  if (item.lookup === "queued" || item.lookup === "loading") return "Finding the album";
  if (item.lookup === "error" || !item.query) return "Album not found";
  if (!conditionComplete(item.condition ?? {})) return "Grade it";
  const photos = autoState(item).photos.length;
  if (photos < AUTO_PHOTOS.length) return photos ? "Take the back cover photo" : "Take the cover photos";
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
  if (!a || !BUSY_STAGES.includes(a.stage)) return item;
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

const money = (n: number) => n.toFixed(2);

/**
 * The price check as text for Claude, who picks the price on the Auto tab:
 * the computed suggestions plus the copies behind them (sold first).
 */
export function priceEvidence(
  check: PriceCheck,
  max = 15,
  discogs?: { ref: DiscogsReference; grade: Grade | undefined },
): string {
  const lines: string[] = [];
  const block = (label: string, s: PriceCheck["sold"], items: PriceCheck["soldItems"]) => {
    if (!s || s.usedCount === 0) {
      lines.push(`${label}: none found.`);
      return;
    }
    lines.push(
      `${label} (${s.currency}, ${s.usedCount} copies, ${s.confidence} confidence): quick sale ${money(s.itemPrice.quickSale)}, typical ${money(s.itemPrice.recommended)}, high ${money(s.itemPrice.high)}. Assumed shipping ${money(s.assumedShipping ?? 0)}.`,
    );
    for (const c of items.slice(0, max)) {
      const ship = c.shippingCost ? ` + ${money(c.shippingCost.value)} shipping` : "";
      const when = c.soldDate ? `, sold ${c.soldDate.slice(0, 10)}` : "";
      const cond = c.condition ? `, ${c.condition}` : "";
      lines.push(`- ${money(c.price.value)}${ship}${when}${cond}: ${c.title}`);
    }
  };
  block("Sold copies", check.sold, check.soldItems);
  block("Listed now (asking prices)", check.current, check.currentItems);
  if (discogs) lines.push(discogsEvidence(discogs.ref, discogs.grade));
  const bounds = priceBounds(check, discogs ? discogsCad(discogs.ref, discogs.grade) : undefined);
  if (bounds) lines.push(`Allowed range: ${money(bounds.min)} to ${money(bounds.max)}.`);
  return lines.join("\n");
}

/**
 * The range Claude's price must stay in: around what sold (or is listed), so a
 * slip can't list at $1 or $500. A Discogs price for the grade (CAD) widens it
 * up to 115% of that price, or sets it (70-115%) when eBay found no copies.
 */
export function priceBounds(check: PriceCheck, discogs?: number): { min: number; max: number } | null {
  const s = check.sold && check.sold.usedCount > 0 ? check.sold : check.current && check.current.usedCount > 0 ? check.current : null;
  const r = (n: number) => Math.round(n * 100) / 100;
  if (!s) return discogs ? { min: Math.max(0.99, r(discogs * 0.7)), max: r(discogs * 1.15) } : null;
  const min = Math.max(0.99, r(s.itemPrice.quickSale * 0.85));
  const max = Math.max(min, r(s.itemPrice.high * 1.15), discogs ? r(discogs * 1.15) : 0);
  return { min, max };
}

/**
 * Claude's price when it gave one, kept inside priceBounds; else the computed
 * price (pickAutoPrice).
 */
export function finalAutoPrice(
  check: PriceCheck,
  claude: { price: number; reason: string } | undefined,
  discogs?: number,
): { price: number; basis: string } | null {
  const fallback = pickAutoPrice(check) ?? (discogs ? { price: discogs, basis: "No eBay copies: Discogs price guide for this grade" } : null);
  const bounds = priceBounds(check, discogs);
  if (!claude || !bounds || !(claude.price > 0)) return fallback;
  const price = Math.min(bounds.max, Math.max(bounds.min, claude.price));
  const clamped = price !== claude.price ? ` (kept inside ${money(bounds.min)}-${money(bounds.max)})` : "";
  return { price, basis: `Claude: ${claude.reason || "picked from sold and listed copies"}${clamped}` };
}

/**
 * A special edition (no barcode, Canadian...) whose sold copies went for more
 * than the price picked: the edition's typical sold price wins.
 */
export function withEditionPrice(
  picked: { price: number; basis: string },
  edition: EditionPrice | null,
): { price: number; basis: string } {
  return edition && edition.price > picked.price ? { price: edition.price, basis: edition.reason } : picked;
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
    running: items.filter((x) => BUSY_STAGES.includes(stage(x))).length,
    published: items.filter((x) => stage(x) === "published").length,
    failed: items.filter((x) => x.status === "pending" && stage(x) === "failed").length,
  };
}

/** Short label for a CD's progress in the run. */
export function stageLabel(stage: AutoState["stage"]): string {
  switch (stage) {
    case "identifying":
      return "Reading the cover…";
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

export interface PriceComparison {
  /** "sold" when there were sales, else the current listings. */
  basis: "sold" | "current";
  count: number;
  min: number;
  max: number;
  median: number;
  /** How many of those copies were cheaper than the listing's price. */
  cheaper: number;
}

/** Where a published listing's price sits among the copies its price check found (item prices, no shipping). */
export function compareToComparables(price: number, check: PriceCheck | undefined): PriceComparison | null {
  if (!check) return null;
  const basis = check.soldItems.length ? "sold" : check.currentItems.length ? "current" : null;
  if (!basis) return null;
  const values = (basis === "sold" ? check.soldItems : check.currentItems).map((c) => c.price.value).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return {
    basis,
    count: values.length,
    min: values[0],
    max: values[values.length - 1],
    median: Math.round(median * 100) / 100,
    cheaper: values.filter((v) => v < price).length,
  };
}

/**
 * The barcode lookup found no album (eBay and MusicBrainz don't know it), so
 * the price check could only search the bare barcode. Claude can still read
 * the artist and album off the front cover photo, once per CD.
 */
export function needsCoverName(item: BatchItem): boolean {
  const a = autoState(item);
  return !item.title && a.photos.length > 0 && !a.coverChecked;
}

/**
 * Names the CD from Claude's reading of its front cover. When that gives a new
 * search, a price check saved from the bare barcode is dropped so the next one
 * searches by artist and album (one more sold-price check, worth it since the
 * barcode one found nothing to go on).
 */
export function applyCoverName(item: BatchItem, data: LookupResponse | null): BatchItem {
  const a = { ...autoState(item), coverChecked: true };
  const id = data?.identification;
  const named = !!data && (!!data.album?.title || (!!id?.identified && !!(id.music?.album.trim() || id.title.trim())));
  if (!data || !named) return { ...item, auto: a };
  const looked = applyLookup(item, { ...data, gtin: data.gtin ?? (item.barcode || undefined) });
  if (!looked.query || looked.query === item.query) return { ...looked, auto: a };
  return { ...looked, auto: { ...a, priceCheck: undefined, discogs: undefined, discogsNote: undefined } };
}

/** Why a CD can't be priced: says whether the album was ever named, so the seller knows what was searched. */
export function noCopiesMessage(item: BatchItem): string {
  if (!item.title) {
    return `Nothing found for barcode ${item.barcode}: eBay, MusicBrainz and Discogs don't know it, and the album couldn't be read off the front cover. Tap Try again to scan the barcode again, or list it by hand.`;
  }
  const name = [item.artist, item.title].filter(Boolean).join(" – ");
  return `No sold or listed copies of ${name} found on eBay or Discogs, so there's no price to go on. Tap Try again to scan the barcode again, or list it by hand.`;
}

/**
 * "Try again" on a CD that found nothing: the seller rescans its barcode
 * (often misread the first time). Photos and grades stay; the album is looked
 * up again. The saved price check is kept only when the same barcode comes
 * back, so a rescan of the same number spends no second sold-price check.
 */
export function rescanned(item: BatchItem, gtin: string): BatchItem {
  const a = autoState(item);
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
    auto: {
      ...a,
      stage: "waiting",
      coverChecked: undefined,
      priceCheck: same ? a.priceCheck : undefined,
      discogs: same ? a.discogs : undefined,
      discogsNote: same ? a.discogsNote : undefined,
    },
  };
}

/** Whether "Try again" rescans the barcode: the CD failed before Claude wrote it (nothing found to price). */
export function retryByRescan(item: BatchItem): boolean {
  const a = autoState(item);
  return a.stage === "failed" && !a.draft;
}
