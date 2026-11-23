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
import type { Condition } from "../ebay/sell";

/** Other versions, by a title word. Each is skipped if the seller's keywords use it too. */
const OTHER_VERSIONS: { label: string; re: RegExp }[] = [
  { label: "Japanese", re: /\bjapan(ese)?\b|\bobi\b|\bshm[- ]?cd\b|\bblu[- ]?spec\b/i },
  { label: "SACD", re: /\bsacd\b/i },
  { label: "vinyl", re: /\bvinyl\b|\blps?\b|\brecord\b|\b(7|10|12)"|\b33 ?rpm\b/i },
  { label: "cassette", re: /\bcass?ette\b|\btapes?\b|\b8[- ]?track\b/i },
  { label: "DVD", re: /\bdvd\b|\bblu[- ]?ray\b/i },
  { label: "box set", re: /\bbox(ed)? ?set\b/i },
  { label: "lot", re: /\blot\b|\bbundle\b/i },
  { label: "signed", re: /\bsigned\b|\bautograph(ed)?\b/i },
];

/** True when the item text names a format other than CD (the seller then sells that). */
export function namesOtherFormat(keywords: string): boolean {
  return /\b(vinyl|lps?|records?|cass?ettes?|tapes?|8[- ]?track|dvd|blu[- ]?ray)\b/i.test(keywords);
}

/**
 * Keywords for a CD search: adds "CD" and, for eBay's web search (used by
 * sold-comps.com), excludes other formats with -word. Unchanged when the
 * seller's text names another format.
 */
export function cdKeywords(keywords: string, opts: { exclude?: boolean } = {}): string {
  const k = keywords.trim();
  if (!k || namesOtherFormat(k)) return k;
  const withCd = /\bcds?\b/i.test(k) ? k : `${k} CD`;
  return opts.exclude ? `${withCd} -vinyl -lp -cassette -tape -record` : withCd;
}

/** Only CDs of the item: drops other formats, lots and signed copies (unless the seller's text names them). */
export function onlyCds(items: Comparable[], keywords = ""): Comparable[] {
  return items.filter((c) => !otherVersion(c.title, keywords));
}

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

/** A comparable's eBay condition text ("Pre-Owned", "Very Good", "Brand New"...) as a condition group. */
export function conditionGroup(text: string | null): { isNew: boolean; level: Condition | null } {
  const t = (text ?? "").toLowerCase();
  if (/like new/.test(t)) return { isNew: false, level: "LIKE_NEW" };
  if (/\bnew\b|sealed/.test(t) && !/open box|other|defect/.test(t)) return { isNew: true, level: "NEW" };
  if (/very good/.test(t)) return { isNew: false, level: "USED_VERY_GOOD" };
  if (/acceptable/.test(t)) return { isNew: false, level: "USED_ACCEPTABLE" };
  if (/\bgood\b/.test(t)) return { isNew: false, level: "USED_GOOD" };
  return { isNew: false, level: null }; // "Pre-Owned", "Used": used, level unknown
}

/**
 * Comparables in the seller's condition: sealed copies for a sealed CD, used
 * ones otherwise, and the same eBay grade (Like new, Very good...) when at
 * least MIN_MATCHES copies have it. Too few matches and the wider set is kept.
 */
export function sameCondition(items: Comparable[], condition: Condition | undefined): Comparable[] {
  if (!condition) return items;
  const wantNew = condition === "NEW";
  const sameGroup = items.filter((c) => conditionGroup(c.condition).isNew === wantNew);
  if (sameGroup.length < MIN_MATCHES) return items;
  if (wantNew) return sameGroup;
  const sameLevel = sameGroup.filter((c) => conditionGroup(c.condition).level === condition);
  return sameLevel.length >= MIN_MATCHES ? sameLevel : sameGroup;
}
