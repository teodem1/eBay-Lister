/**
 * Picks the comparables that match the seller's version of a CD.
 *
 * Guillaume's CDs are mostly Canadian pressings (Canadian distributors), so
 * prices come from Canadian copies when there are enough of them: sold from
 * Canada, or titled "Canada"/"Canadian". Other versions that sell for very
 * different prices (Japanese pressings, vinyl, signed copies, lots) are left
 * out unless the seller's own item text asks for them.
 * Pure functions, shared by the price route and the price screen.
 */
import type { Comparable } from "../ebay/types";

/** Other versions, by a title word. Each is skipped if the seller's keywords use it too. */
const OTHER_VERSIONS: { label: string; re: RegExp }[] = [
  { label: "Japanese", re: /\bjapan(ese)?\b|\bobi\b|\bshm[- ]?cd\b|\bblu[- ]?spec\b/i },
  { label: "SACD", re: /\bsacd\b/i },
  { label: "vinyl", re: /\bvinyl\b|\blp\b|\b(7|10|12)"/i },
  { label: "cassette", re: /\bcassette\b|\btape\b/i },
  { label: "box set", re: /\bbox(ed)? ?set\b/i },
  { label: "lot", re: /\blot\b|\bbundle\b/i },
  { label: "signed", re: /\bsigned\b|\bautograph(ed)?\b/i },
];

/** Fewer matching copies than this and the filter is dropped (too little data). */
export const MIN_MATCHES = 3;

/** The other-version label a title has, unless the seller's keywords share it. */
export function otherVersion(title: string, keywords = ""): string | null {
  for (const v of OTHER_VERSIONS) {
    if (v.re.test(title) && !v.re.test(keywords)) return v.label;
  }
  return null;
}

/** A copy from the home country: sold from there, or titled as that country's pressing. */
export function isHomeCopy(c: Comparable, homeCountry: string): boolean {
  if (c.itemLocation.country === homeCountry) return true;
  return homeCountry === "CA" && /\bcanad(a|ian)\b/i.test(c.title);
}

export interface VersionSelection {
  items: Comparable[];
  /** Comparables left out as another version (Japanese, vinyl, signed...). */
  otherVersionsLeftOut: number;
  /** Set when prices use only home-country copies. */
  homeCountry: string | null;
  notes: string[];
}

export function selectSameVersion(
  items: Comparable[],
  opts: { keywords?: string; homeCountry?: string; unit?: string },
): VersionSelection {
  const notes: string[] = [];
  const unit = opts.unit ?? "comparables";
  let kept = items.filter((c) => !otherVersion(c.title, opts.keywords));
  let otherVersionsLeftOut = items.length - kept.length;
  if (kept.length < MIN_MATCHES) {
    kept = items;
    otherVersionsLeftOut = 0;
  } else if (otherVersionsLeftOut) {
    notes.push(`${otherVersionsLeftOut} ${unit} of other versions (Japanese, vinyl, signed, lots...) left out.`);
  }

  let homeCountry: string | null = null;
  if (opts.homeCountry) {
    const home = kept.filter((c) => isHomeCopy(c, opts.homeCountry!));
    const name = opts.homeCountry === "CA" ? "Canadian" : opts.homeCountry;
    if (home.length >= MIN_MATCHES) {
      notes.push(`Based on ${home.length} ${name} copies (sold from ${opts.homeCountry} or titled ${name}).`);
      kept = home;
      homeCountry = opts.homeCountry;
    } else if (kept.length) {
      notes.push(`Only ${home.length} ${name} ${unit} found, so copies from everywhere were used.`);
    }
  }
  return { items: kept, otherVersionsLeftOut, homeCountry, notes };
}
