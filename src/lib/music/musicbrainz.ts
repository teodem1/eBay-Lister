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
  /** Facts about this exact pressing, when MusicBrainz has them (barcode lookups). */
  release?: ReleaseFacts;
}

/** What MusicBrainz knows about one pressing: used as facts in the listing's title and item specifics. */
export interface ReleaseFacts {
  label?: string;
  catalogNumber?: string;
  /** Two-letter country of release, e.g. "CA", "US", "XE" (Europe). */
  country?: string;
  /** Release date of this pressing, "YYYY" or "YYYY-MM-DD". */
  date?: string;
  /** Number of discs. */
  discs?: number;
  /** Medium format, e.g. "CD", "Enhanced CD". */
  format?: string;
  packaging?: string;
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
  country?: string;
  packaging?: string;
  "label-info"?: { "catalog-number"?: string; label?: { name?: string } }[];
  media?: { format?: string }[];
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
    release: releaseFacts(r),
  };
}

function releaseFacts(r: MbRelease): ReleaseFacts | undefined {
  const label = r["label-info"]?.find((l) => l.label?.name && !/^\[no label\]$/i.test(l.label.name));
  const facts: ReleaseFacts = {
    label: label?.label?.name,
    catalogNumber: label?.["catalog-number"] || undefined,
    country: r.country || undefined,
    date: r.date || undefined,
    discs: r.media?.length || undefined,
    format: r.media?.[0]?.format || undefined,
    packaging: r.packaging && r.packaging !== "None" ? r.packaging : undefined,
  };
  const set = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) as ReleaseFacts;
  return Object.keys(set).length ? set : undefined;
}

const COUNTRY_NAMES: Record<string, string> = {
  CA: "Canada", US: "United States", GB: "United Kingdom", XE: "Europe", DE: "Germany", JP: "Japan",
  FR: "France", NL: "Netherlands", AU: "Australia", IT: "Italy", MX: "Mexico", BR: "Brazil", XW: "Worldwide",
};

/** The pressing facts as plain lines for Claude, e.g. "Record label: Atlantic". */
export function releaseFactsText(album: AlbumInfo): string {
  const r = album.release ?? {};
  const lines = [
    `Artist: ${album.artist}`,
    `Album: ${album.title}`,
    r.date ? `Release date of this pressing: ${r.date}` : album.year ? `Release year: ${album.year}` : null,
    r.label ? `Record label: ${r.label}` : null,
    r.catalogNumber ? `Catalog number: ${r.catalogNumber}` : null,
    r.country ? `Country of release: ${COUNTRY_NAMES[r.country] ?? r.country}` : null,
    r.format ? `Format: ${r.format}` : null,
    r.discs ? `Number of discs: ${r.discs}` : null,
    r.packaging ? `Packaging: ${r.packaging}` : null,
    album.genres.length ? `Genre tags: ${album.genres.join(", ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
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
