/**
 * Album details for CDs from MusicBrainz (free, no key) with covers from the
 * Cover Art Archive. Server-side only, so the browser never calls them directly.
 * `fetch` is injectable for tests.
 */
import type { FetchLike } from "../ebay/client";

export interface AlbumInfo {
  /** Album name. */
  title: string;
  /** Artist or group, as credited. */
  artist: string;
  /** Four-digit release year, if known. */
  year?: number;
  /** Front cover image (250px), if MusicBrainz has one. */
  coverUrl?: string;
  /** Genre-like tags from MusicBrainz, most voted first. */
  genres: string[];
  mbid: string;
}

const API = "https://musicbrainz.org/ws/2";
// MusicBrainz asks every client to identify itself.
const USER_AGENT = "eBayLister/0.1 ( https://e-bay-lister-nu.vercel.app )";
const TIMEOUT_MS = 4000;

interface MbRelease {
  id: string;
  score?: number;
  title: string;
  date?: string;
  "artist-credit"?: { name: string; joinphrase?: string }[];
  "release-group"?: { id: string; "primary-type"?: string };
  tags?: { name: string; count: number }[];
}

/** Album for a UPC/EAN printed on a CD, or null when MusicBrainz doesn't know it. */
export async function albumByBarcode(gtin: string, fetchImpl: FetchLike = fetch): Promise<AlbumInfo | null> {
  const digits = gtin.replace(/\D/g, "");
  if (!digits) return null;
  // CD barcodes are stored as printed: try the 12-digit UPC as well as the EAN-13 form.
  const forms = new Set([digits, digits.replace(/^0(\d{12})$/, "$1")]);
  const query = [...forms].map((d) => `barcode:${d}`).join(" OR ");
  return first(await search(query, fetchImpl), 0);
}

/** Album by name and artist, e.g. from a photo of the cover. */
export async function albumByName(album: string, artist: string, fetchImpl: FetchLike = fetch): Promise<AlbumInfo | null> {
  if (!album.trim()) return null;
  const parts = [`release:"${escape(album)}"`];
  if (artist.trim()) parts.push(`artist:"${escape(artist)}"`);
  // Name searches are fuzzy; only trust strong matches.
  return first(await search(parts.join(" AND "), fetchImpl), 90);
}

async function search(query: string, fetchImpl: FetchLike): Promise<MbRelease[]> {
  const url = `${API}/release/?${new URLSearchParams({ query, fmt: "json", limit: "5" })}`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  const data = (await res.json()) as { releases?: MbRelease[] };
  return data.releases ?? [];
}

function first(releases: MbRelease[], minScore: number): AlbumInfo | null {
  const r = releases.find((x) => (x.score ?? 100) >= minScore);
  return r ? toAlbum(r) : null;
}

export function toAlbum(r: MbRelease): AlbumInfo {
  const artist = (r["artist-credit"] ?? []).map((c) => c.name + (c.joinphrase ?? "")).join("").trim();
  const year = Number(r.date?.slice(0, 4));
  const group = r["release-group"]?.id;
  return {
    title: r.title,
    artist,
    year: Number.isInteger(year) && year > 1800 ? year : undefined,
    // Covers are usually attached to the release group; fall back to the release itself.
    coverUrl: group
      ? `https://coverartarchive.org/release-group/${group}/front-250`
      : `https://coverartarchive.org/release/${r.id}/front-250`,
    genres: [...(r.tags ?? [])]
      .sort((a, b) => b.count - a.count)
      .map((t) => t.name)
      .slice(0, 3),
    mbid: r.id,
  };
}

function escape(s: string): string {
  return s.replace(/(["\\])/g, "\\$1");
}

/** Never lets a MusicBrainz problem break the eBay lookup. */
export async function safely<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}
