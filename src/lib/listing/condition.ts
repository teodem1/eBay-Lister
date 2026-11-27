// The seller's own condition for a CD, asked before Claude writes the listing.
// It sets the eBay condition and the condition text; Claude never guesses them.
import type { Condition } from "../ebay/sell";
import type { SellerCondition } from "./conditionSchema";

/** The eBay conditions offered for a CD, in the seller's words. Music categories accept these. */
export const CD_CONDITIONS = [
  { value: "NEW", label: "New, sealed" },
  { value: "LIKE_NEW", label: "Like new" },
  { value: "USED_VERY_GOOD", label: "Very good" },
  { value: "USED_GOOD", label: "Good" },
  { value: "USED_ACCEPTABLE", label: "Acceptable" },
] as const satisfies readonly { value: Condition; label: string }[];

export const GRADES = ["Mint", "Near mint", "Very good+", "Very good", "Good", "Fair", "Poor"] as const;
export type Grade = (typeof GRADES)[number];

/** The parts of a CD the seller grades. Case and booklet can also be missing. */
export const PARTS = [
  { key: "disc", label: "Disc" },
  { key: "booklet", label: "Inlay / booklet" },
  { key: "case", label: "Case" },
] as const;
export type PartKey = (typeof PARTS)[number]["key"];

export type { SellerCondition } from "./conditionSchema";

export function conditionLabel(c: Condition): string {
  return CD_CONDITIONS.find((x) => x.value === c)?.label ?? c;
}

/**
 * The seller's condition as one short text, used as eBay's condition
 * description and given to Claude as the only facts about condition.
 */
export function conditionSummary(sc: SellerCondition): string {
  const parts: string[] = [];
  if (sc.condition === "NEW") parts.push("New, factory sealed.");
  for (const { key, label } of PARTS) {
    const grade = sc[key];
    if (!grade) continue;
    parts.push(grade === "Missing" ? `${label}: missing.` : `${label}: ${grade.toLowerCase()}.`);
  }
  if (sc.tested) parts.push("Tested: plays through without skips.");
  const notes = sc.notes?.replace(/\s+/g, " ").trim();
  if (notes) {
    const sentence = notes[0].toUpperCase() + notes.slice(1);
    parts.push(/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
  }
  // eBay caps the condition description at 1000 characters.
  return parts.join(" ").slice(0, 1000);
}

/** A grade as the title writes it: "Near mint" -> "Near Mint", "Very good+" -> "Very Good+". */
const titleCase = (g: string) => g.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The condition part of the listing title, e.g. "(Disc: Near Mint / Inlay: Very Good+)".
 * Empty when there is nothing to say; "(Sealed)" for a new sealed CD.
 */
export function conditionTitleSuffix(sc: SellerCondition): string {
  if (sc.condition === "NEW") return "(Sealed)";
  const parts: string[] = [];
  if (sc.disc) parts.push(`Disc: ${titleCase(sc.disc)}`);
  if (sc.booklet) parts.push(`Inlay: ${titleCase(sc.booklet)}`);
  return parts.length ? `(${parts.join(" / ")})` : "";
}

/**
 * The listing title for a graded CD: "Artist Album CD (Disc: Near Mint / Inlay: Near Mint)".
 * Any format word Claude left at the end of the album name is dropped first.
 * `extras` are buyer search terms (year, label, "Canada", "Remastered", "2CD"...) put
 * before " CD (...)", in order, each only if the whole title still fits in `max`,
 * so the title uses the 80 characters without ever cutting the album or the grades.
 */
export function cdTitle(album: string, sc: SellerCondition, max = 80, extras: string[] = []): string {
  // A disc count ("2CD", "3 CD", "double CD") replaces the format word: "... 2CD (Disc: ...)".
  const discs = extras.map((e) => /^\s*(\d)\s*-?\s*(?:x\s*)?cds?\s*$/i.exec(e)?.[1]).find(Boolean);
  const format = discs && discs !== "1" ? `${discs}CD` : "CD";
  const suffix = `${format} ${conditionTitleSuffix(sc)}`.trim();
  let name = album.replace(/\s+/g, " ").replace(/[\s\-–,]*\b(compact disc|\d?\s*cds?)\b\s*$/i, "").trim();
  const room = max - suffix.length - 1;
  if (name.length > room) name = shortenName(name, room);
  for (const raw of extras) {
    const extra = raw.replace(/\s+/g, " ").replace(/[()]/g, "").trim();
    // Never repeat a word the title already has; format words are the app's.
    if (!extra || /^(compact disc|cds?|\d\s*-?\s*(x\s*)?cds?|double cd)$/i.test(extra)) continue;
    const words = extra.toLowerCase().split(" ");
    const have = `${name} ${suffix}`.toLowerCase().split(/[\s/()]+/);
    if (words.every((w) => have.includes(w))) continue;
    if (name.length + 1 + extra.length + 1 + suffix.length <= max) name = `${name} ${extra}`;
  }
  return `${name} ${suffix}`;
}

const DANGLING = /\s+(and|&|of|the|a|an|in|on|to|for|with|from|at|by|or|-|–|:)$/i;

/**
 * Fits "Artist Album" into `room` characters: drops a subtitle after ":" or " - " or
 * in brackets first, then cuts at a word and never ends on "and", "of", "the"...
 */
function shortenName(name: string, room: number): string {
  let out = name;
  for (const cut of [/\s*\([^)]*\)?\s*$/, /\s*\[[^\]]*\]?\s*$/, /\s*[:–]\s.*$|:\S.*$/, /\s+-\s.*$/]) {
    if (out.length <= room) break;
    const shorter = out.replace(cut, "").trim();
    if (shorter.length >= room * 0.4) out = shorter;
  }
  if (out.length > room) {
    const piece = out.slice(0, room + 1);
    const space = piece.lastIndexOf(" ");
    out = (space > room * 0.6 ? piece.slice(0, space) : out.slice(0, room)).trim();
  }
  while (DANGLING.test(out)) out = out.replace(DANGLING, "").trim();
  return out.replace(/[\s,;:&-]+$/, "").trim();
}

/** Which eBay condition each grade maps to (eBay's music conditions). */
const GRADE_CONDITION: Record<Grade, Condition> = {
  Mint: "LIKE_NEW",
  "Near mint": "LIKE_NEW",
  "Very good+": "USED_VERY_GOOD",
  "Very good": "USED_VERY_GOOD",
  Good: "USED_GOOD",
  Fair: "USED_ACCEPTABLE",
  Poor: "USED_ACCEPTABLE",
};

/**
 * The eBay condition for a used CD, from the worse of the disc and inlay
 * grades (buyers judge by the weakest part). A missing inlay counts as Good.
 */
export function ebayConditionFromGrades(disc?: Grade, inlay?: Grade | "Missing"): Condition | undefined {
  if (!disc) return undefined;
  const order = Object.keys(GRADE_CONDITION) as Grade[];
  const inlayGrade: Grade | undefined = inlay === "Missing" ? "Good" : inlay;
  const worst = inlayGrade && order.indexOf(inlayGrade) > order.indexOf(disc) ? inlayGrade : disc;
  return GRADE_CONDITION[worst];
}

/** A sealed CD needs nothing more; a used one needs the disc and the inlay graded. */
export function conditionComplete(sc: Partial<SellerCondition>): sc is SellerCondition {
  if (!sc.condition) return false;
  return sc.condition === "NEW" || (!!sc.disc && !!sc.booklet);
}

/** The seller's grades as URL params, so the scan screen can hand them to the listing screen. */
export function conditionParams(sc: Partial<SellerCondition>): Record<string, string> {
  const p: Record<string, string> = {};
  if (sc.condition === "NEW") p.sealed = "1";
  if (sc.disc) p.disc = sc.disc;
  if (sc.booklet) p.inlay = sc.booklet;
  if (sc.case) p.case = sc.case;
  if (sc.tested) p.tested = "1";
  if (sc.notes) p.defects = sc.notes;
  return p;
}

/** Reads conditionParams back; unknown values are ignored. */
export function conditionFromParams(get: (key: string) => string | undefined): Partial<SellerCondition> {
  const grade = (v?: string) => (GRADES as readonly string[]).includes(v ?? "") ? (v as Grade) : undefined;
  const part = (v?: string) => (v === "Missing" ? ("Missing" as const) : grade(v));
  if (get("sealed") === "1") return { condition: "NEW", notes: get("defects") || undefined };
  const disc = grade(get("disc"));
  const booklet = part(get("inlay"));
  const out: Partial<SellerCondition> = {
    disc,
    booklet,
    case: part(get("case")),
    tested: get("tested") === "1" || undefined,
    notes: get("defects") || undefined,
    condition: ebayConditionFromGrades(disc, booklet),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<SellerCondition>;
}
