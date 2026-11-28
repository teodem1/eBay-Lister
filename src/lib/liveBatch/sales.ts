/**
 * A live listing's stored sold sales in its grade, as the batch priced it: the stored lookup for its
 * barcode, else its short search name, else its full name (saved before names were shortened).
 * Reads storage only: never a sold-comps lookup. Unreadable storage rejects.
 */
import { lookupKeys, type StoredLookup } from "../comps/record";
import { readLookup, type Backend } from "../comps/store";
import type { LiveDetail } from "../ebay/refreshListings";
import type { Comparable } from "../ebay/types";
import { searchName } from "../pricing/version";

export async function listingSales(
  b: Backend,
  live: Pick<LiveDetail, "barcode" | "query">,
): Promise<{ sales: Comparable[]; savedAt: string | null; partial: boolean }> {
  let lookup: StoredLookup | null = await readLookup(b, lookupKeys({ barcode: live.barcode, name: searchName(live.query) }));
  const usableBarcode = lookupKeys({ barcode: live.barcode }).length > 0;
  if (!lookup && !usableBarcode && searchName(live.query) !== live.query) {
    lookup = await readLookup(b, lookupKeys({ name: live.query }));
  }
  if (!lookup) return { sales: [], savedAt: null, partial: false };
  const keep = new Set(lookup.filtered.sameGrade);
  const items = lookup.queries.at(-1)?.items ?? [];
  return { sales: items.filter((i) => keep.has(i.itemId)), savedAt: lookup.savedAt, partial: lookup.partial };
}
