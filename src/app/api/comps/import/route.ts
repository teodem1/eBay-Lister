/**
 * POST /api/comps/import  { items: [{ barcode?, priceCheckedAt, priceCheck: { keywords, condition?, soldItems } }] }
 *
 * Stores the backup's price checks as partial lookups (at most 300 per call;
 * a full lookup already stored is kept). Plugin only, behind the access key.
 *   200 { saved, kept, skipped } · 400 invalid body · 503 no Blob store · 502 storage error
 */
import { importBackup, ImportBody } from "@/lib/comps/importBackup";
import { blobBackend } from "@/lib/comps/store";

export async function POST(request: Request) {
  const parsed = ImportBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid import." }, { status: 400 });
  const store = blobBackend();
  if (!store) return Response.json({ error: "Stored lookups are not set up (no Blob store)." }, { status: 503 });
  try {
    return Response.json(await importBackup(store, parsed.data.items));
  } catch (err) {
    console.error("importing stored lookups failed", err);
    return Response.json({ error: "Stored lookups could not be read or written." }, { status: 502 });
  }
}
