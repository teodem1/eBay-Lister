// The seller's own condition for a CD, asked before Claude writes the listing.
// It sets the eBay condition and the condition text; Claude never guesses them.
import { z } from "zod";
import type { Condition } from "../ebay/sell";

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

const PartGrade = z.union([z.enum(GRADES), z.literal("Missing")]);

export const SellerConditionSchema = z.object({
  condition: z.enum(CD_CONDITIONS.map((c) => c.value) as [Condition, ...Condition[]]),
  disc: z.enum(GRADES).optional(),
  case: PartGrade.optional(),
  booklet: PartGrade.optional(),
  /** The seller played it through. Only then may the listing say "tested". */
  tested: z.boolean().optional(),
  /** Defects or anything else in the seller's words. */
  notes: z.string().max(600).optional(),
});
export type SellerCondition = z.infer<typeof SellerConditionSchema>;

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

/** Short grades for the title, as record sellers write them. */
const GRADE_ABBR: Record<Grade, string> = {
  Mint: "M",
  "Near mint": "NM",
  "Very good+": "VG+",
  "Very good": "VG",
  Good: "G",
  Fair: "F",
  Poor: "P",
};

/**
 * The condition part of the listing title, e.g. "CD: NM / Inlay: VG+".
 * Empty when there is nothing to say; "Sealed" for a new sealed CD.
 */
export function conditionTitleSuffix(sc: SellerCondition): string {
  if (sc.condition === "NEW") return "Sealed";
  const parts: string[] = [];
  if (sc.disc) parts.push(`CD: ${GRADE_ABBR[sc.disc]}`);
  if (sc.booklet === "Missing") parts.push("No Inlay");
  else if (sc.booklet) parts.push(`Inlay: ${GRADE_ABBR[sc.booklet]}`);
  return parts.join(" / ");
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
