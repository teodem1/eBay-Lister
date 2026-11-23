// Validation for the seller's condition, used by the server routes. Kept apart from
// condition.ts so the screens that grade a CD don't download zod.
import { z } from "zod";
import type { Condition } from "../ebay/sell";
import { CD_CONDITIONS, GRADES } from "./condition";

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
