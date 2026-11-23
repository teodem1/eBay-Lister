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
  { key: "case", label: "Case" },
  { key: "booklet", label: "Inlay / booklet" },
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

/** A sealed CD has no part grades; a used one needs at least the disc graded. */
export function conditionComplete(sc: Partial<SellerCondition>): sc is SellerCondition {
  if (!sc.condition) return false;
  return sc.condition === "NEW" || !!sc.disc;
}
