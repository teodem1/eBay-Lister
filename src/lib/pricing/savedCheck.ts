/**
 * Finding a price check already saved on the phone, so the same CD is never paid
 * for twice: on a To list or Auto entry (by SKU, barcode or search text) or on a
 * Collection CD. Sort a pile, Collection "Check sold prices" and Update live listings
 * share it. Pure, for tests.
 */
import type { BatchItem } from "../batch/queue";
import { barcodeFromSku } from "../identify/barcode";
import type { CollectionItem } from "../collection/collection";
import { checkKey } from "../sort/worth";
import type { PriceCheck } from "./priceCheck";


/**
 * A check worth reusing: one that came back without sold prices because the monthly
 * allowance was used up is not, so the next check (after it resets) gets them.
 */
export function reusable(check: PriceCheck | undefined): PriceCheck | undefined {
  return check && !check.soldLimitReached ? check : undefined;
}

/** The check a To list or Auto entry holds, if any. */
export function checkOnItem(x: BatchItem): PriceCheck | undefined {
  return reusable(x.auto?.priceCheck ?? x.priceCheck ?? x.progress?.priceCheck);
}

export interface CheckMatch {
  sku?: string;
  barcode?: string;
  /** `checkKey` of the CD's search text (no barcode). */
  key?: string;
}

const skuOf = (x: BatchItem) => x.auto?.draft?.sku ?? x.progress?.draft?.sku;

/** A saved check on To list / Auto (and the Collection, when given): same SKU, else barcode, else search text. */
export function savedCheckFor(items: BatchItem[], match: CheckMatch, cds: CollectionItem[] = []): PriceCheck | undefined {
  const barcode = match.barcode || barcodeFromSku(match.sku);
  const tests: ((check: PriceCheck, item: { sku?: string; barcode?: string }) => boolean)[] = [];
  if (match.sku) tests.push((_, x) => x.sku === match.sku);
  if (barcode) tests.push((_, x) => x.barcode === barcode);
  if (match.key) tests.push((check) => checkKey(check.keywords) === match.key);
  const pool = [
    ...cds.map((x) => ({ check: reusable(x.priceCheck), sku: x.sku, barcode: x.barcode })),
    ...items.map((x) => ({ check: checkOnItem(x), sku: skuOf(x), barcode: x.barcode })),
  ];
  for (const test of tests) {
    const hit = pool.find((x) => x.check && test(x.check, x));
    if (hit) return hit.check;
  }
  return undefined;
}
