/**
 * A live listing's stored sold sales: the stored lookup for its barcode, else its short search name, else
 * its full name (saved before names were shortened). `sales` are the CDs in the given grade (the listing's
 * own, as the batch priced it; the lookup's saved grade when none is given), `cds` every CD sale in any
 * grade (what interest is measured from). Reads storage only: never a sold-comps lookup. Unreadable storage rejects.
 */
import { filterLookup, lookupKeys, type StoredLookup } from "../comps/record";
import type { Condition } from "../ebay/conditions";
import { readLookup, type Backend } from "../comps/store";
import type { LiveDetail } from "../ebay/refreshListings";
import type { Comparable } from "../ebay/types";
import { searchName } from "../pricing/version";

export async function listingSales(
  b: Backend,
  live: Pick<LiveDetail, "barcode" | "query">,
  condition?: Condition,
): Promise<{ sales: Comparable[]; cds: Comparable[]; savedAt: string | null; partial: boolean }> {
  let lookup: StoredLookup | null = await readLookup(b, lookupKeys({ barcode: live.barcode, name: searchName(live.query) }));
  const usableBarcode = lookupKeys({ barcode: live.barcode }).length > 0;
  if (!lookup && !usableBarcode && searchName(live.query) !== live.query) {
    lookup = await readLookup(b, lookupKeys({ name: live.query }));
  }
  if (!lookup) return { sales: [], cds: [], savedAt: null, partial: false };
  const filtered = condition ? filterLookup(lookup.queries, lookup.name ?? searchName(live.query), condition) : lookup.filtered;
  const items = lookup.queries.at(-1)?.items ?? [];
  const pick = (ids: string[]) => {
    const keep = new Set(ids);
    return items.filter((i) => keep.has(i.itemId));
  };
  return { sales: pick(filtered.sameGrade), cds: pick(filtered.cdOnly), savedAt: lookup.savedAt, partial: lookup.partial };
}
