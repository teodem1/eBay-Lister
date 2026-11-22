/** Shapes shared by the lookup API routes and the page. */
import type { SearchResult } from "./ebay/client";
import type { PhotoIdentification } from "./identify/vision";
import type { AlbumInfo } from "./music/musicbrainz";

export interface LookupResponse {
  source: "barcode" | "photo";
  /** Barcode used for the eBay search, if any. */
  gtin?: string;
  /** Keywords used for the eBay search, if any. */
  query?: string;
  /** Present for photo lookups: what Claude thinks the item is. */
  identification?: PhotoIdentification;
  results: SearchResult;
  /** Album details when the item is a CD (or other music release) MusicBrainz knows. */
  album?: AlbumInfo;
  /** Things the user should know, e.g. "no exact barcode match, showing keyword results". */
  notes: string[];
}

export interface LookupError {
  error: string;
}

/** Hands the identified item to the listing screen (/listing reads q and barcode). */
export function listingHref(data: LookupResponse): string {
  const q = listingQuery(data);
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (data.gtin) params.set("barcode", data.gtin);
  const qs = params.toString();
  return qs ? `/listing?${qs}` : "/listing";
}

/**
 * The item name the listing screen starts from (its ?q=). A CD uses the album
 * from MusicBrainz ("Artist Album"), not an eBay seller's listing title.
 * No " - " between them: eBay keyword search reads "-" as "exclude".
 */
export function listingQuery(data: LookupResponse): string {
  const album = data.album;
  if (album?.title) return [album.artist, album.title].filter(Boolean).join(" ");
  return data.identification?.title || data.query || data.results.items[0]?.title || "";
}
