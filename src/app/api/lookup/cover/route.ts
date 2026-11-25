/**
 * POST /api/lookup/cover { imageUrl, barcode? } -> LookupResponse named from the
 * CD's front cover photo (already on eBay Picture Services). Used on the Auto
 * tab when eBay and MusicBrainz don't know the barcode, so the price check can
 * search by artist and album instead.
 */
import { errorResponse } from "@/lib/api-errors";
import { normalizeGtin } from "@/lib/identify/barcode";
import { photoAlbum } from "@/lib/identify/photoAlbum";
import { identifyFromImageUrl } from "@/lib/identify/vision";
import type { LookupResponse } from "@/lib/lookup";
import { safely } from "@/lib/music/musicbrainz";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { imageUrl?: unknown; barcode?: unknown } | null;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  if (!/^https:\/\/\S+$/.test(imageUrl)) return Response.json({ error: "Send the photo's https imageUrl." }, { status: 400 });
  const gtin = typeof body?.barcode === "string" ? (normalizeGtin(body.barcode) ?? undefined) : undefined;
  try {
    const identification = await identifyFromImageUrl(imageUrl);
    const album = identification.identified ? await safely(photoAlbum(identification, undefined)) : null;
    const payload: LookupResponse = {
      source: "photo",
      gtin,
      query: identification.searchQuery || undefined,
      identification,
      results: { total: 0, items: [] },
      album: album ?? undefined,
      notes: [],
    };
    return Response.json(payload);
  } catch (err) {
    return errorResponse(err);
  }
}
