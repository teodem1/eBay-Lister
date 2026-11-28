/**
 * GET /api/comps?barcode=&name=&condition=
 *
 * The stored sold lookup for a CD (plugin only; the proxy's access key guards it).
 * `filtered` is recomputed for `condition` (else the grade it was stored with).
 *   200 { found: false } | { found: true, lookup, filtered }
 *   400 no usable barcode or name, or an unknown condition
 *   503 no Blob store set up
 *   502 storage could not be read (never answered as "not stored")
 */
import { filterLookup, lookupKeys } from "@/lib/comps/record";
import { blobBackend, readLookup } from "@/lib/comps/store";
import { CONDITIONS, type Condition } from "@/lib/ebay/conditions";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const barcode = params.get("barcode") || undefined;
  const name = params.get("name") || undefined;
  const condition = params.get("condition") || undefined;
  if (condition && !(CONDITIONS as readonly string[]).includes(condition)) {
    return Response.json({ error: "Unknown condition." }, { status: 400 });
  }
  const keys = lookupKeys({ barcode, name });
  if (!keys.length) return Response.json({ error: "Provide a barcode or a name." }, { status: 400 });
  const store = blobBackend();
  if (!store) return Response.json({ error: "Stored lookups are not set up (no Blob store)." }, { status: 503 });
  try {
    const lookup = await readLookup(store, keys);
    if (!lookup) return Response.json({ found: false });
    const filtered = filterLookup(lookup.queries, lookup.name ?? name, (condition as Condition) ?? lookup.condition);
    return Response.json({ found: true, lookup, filtered });
  } catch (err) {
    console.error("reading stored lookup failed", err);
    return Response.json({ error: "Stored lookups could not be read." }, { status: 502 });
  }
}
