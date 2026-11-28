/**
 * One stored sold lookup: every sale SoldComps returned per query, plus the
 * CD-only, same-grade and edition-matched sets (item ids). Stored under a key
 * per barcode and per normalised name, so the plugin reads it instead of
 * spending another lookup. Pure, no storage here.
 */
import type { Condition } from "../ebay/conditions";
import { barcodeKeyword } from "../ebay/soldComps";
import type { Comparable } from "../ebay/types";
import { EDITIONS, matchesEdition, type Edition } from "../pricing/edition";
import { onlyCds, sameCondition } from "../pricing/version";

type Detail = Exclude<Edition, "none">;

export type SoldQuery = { by: "barcode" | "keywords"; items: Comparable[] };

export interface Filtered {
  cdOnly: string[];
  sameGrade: string[];
  detail: Record<Detail, string[]>;
}

export interface StoredLookup {
  version: 1;
  savedAt: string;
  /** True for a check imported from the phone's backup (trimmed), never a full result. */
  partial: boolean;
  barcode?: string;
  name?: string;
  condition?: Condition;
  queries: SoldQuery[];
  filtered: Filtered;
}

const NAME_MAX = 120;
const DETAILS = EDITIONS.filter((e): e is Detail => e !== "none");

function nameSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/, "");
}

/**
 * The storage key for a lookup: the barcode's when it has a usable one (that exact
 * pressing, never another pressing's by-name result), else the name's. Empty when
 * neither gives a key, so nothing is stored under a shared one.
 */
export function lookupKeys(q: { barcode?: string; name?: string }): string[] {
  const digits = (q.barcode ?? "").replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return [`comps/upc/${barcodeKeyword(digits)}.json`];
  const slug = nameSlug(q.name ?? "");
  return slug ? [`comps/name/${slug}.json`] : [];
}

/**
 * The sets the app prices from: the last query's items (the one the price check
 * used), CDs only, then the seller's grade; editions are matched within that set.
 */
export function filterLookup(queries: SoldQuery[], name?: string, condition?: Condition): Filtered {
  const items = queries.at(-1)?.items ?? [];
  const cds = onlyCds(items, name ?? "");
  const graded = sameCondition(cds, condition);
  const ids = (xs: Comparable[]) => xs.map((x) => x.itemId);
  const detail = Object.fromEntries(
    DETAILS.map((d) => [d, ids(graded.filter((x) => matchesEdition(x.title, d)))]),
  ) as Record<Detail, string[]>;
  return { cdOnly: ids(cds), sameGrade: ids(graded), detail };
}
