/**
 * POST /api/price-reference { barcode } -> { discogs } : the Discogs price guide
 * for this pressing (src/lib/pricing/discogs.ts). Used for CDs worth more than a
 * usual CD. Needs DISCOGS_TOKEN; without it answers { discogs: null, unavailable }.
 */
import { discogsReference } from "@/lib/pricing/discogs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { barcode?: string } | null;
  const barcode = body?.barcode?.replace(/\D/g, "") ?? "";
  if (barcode.length < 8) return Response.json({ error: "Send the CD's barcode." }, { status: 400 });
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return Response.json({ discogs: null, unavailable: "Discogs isn't set up (DISCOGS_TOKEN)." });
  try {
    const discogs = await discogsReference(barcode, { token });
    return Response.json({ discogs, unavailable: discogs ? undefined : "Discogs doesn't know this barcode." });
  } catch (err) {
    return Response.json({ discogs: null, unavailable: `Discogs lookup failed: ${(err as Error).message}` });
  }
}
