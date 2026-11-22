// Shared shapes for the listing draft that the review screen edits and the publish route sends to eBay.
import { z } from "zod";
import { CONDITIONS, type Condition } from "../ebay/sell";

export const TITLE_MAX = 80; // eBay hard limit

export const AspectSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  /** True when Claude inferred the value rather than reading it from the input. */
  guessed: z.boolean(),
});
export type Aspect = z.infer<typeof AspectSchema>;

/** What the user describes or scans. Price usually comes from the pricing step. */
export const ItemInputSchema = z.object({
  query: z.string().min(1, "Describe the item"),
  barcode: z.string().optional(),
  notes: z.string().optional(),
  suggestedPrice: z.number().positive().optional(),
});
export type ItemInput = z.infer<typeof ItemInputSchema>;

export const ListingDraftSchema = z.object({
  sku: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/, "SKU: letters, digits, - or _ (max 50)"),
  title: z.string().min(1).max(TITLE_MAX),
  categoryId: z.string().regex(/^\d+$/, "Category ID must be a number"),
  categoryName: z.string().optional(),
  condition: z.enum(CONDITIONS),
  conditionDescription: z.string().max(1000).optional(),
  aspects: z.array(AspectSchema),
  descriptionHtml: z.string().min(1).max(500_000),
  price: z.number().positive(),
  quantity: z.number().int().positive(),
  imageUrls: z.array(z.url()).min(1, "eBay needs at least one photo URL").max(24),
  barcode: z.string().optional(),
  brand: z.string().optional(),
  mpn: z.string().optional(),
  /** Packed weight. eBay needs it when the shipping policy uses calculated shipping. */
  packageWeightKg: z.number().positive().max(500).optional(),
  /** Promoted Listings ad rate for this listing; 0 = don't promote. Unset uses EBAY_PROMOTED_PERCENT. */
  promotedPercent: z.number().min(0).max(100).optional(),
  packageDimensionsCm: z
    .object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
    .optional(),
});
export type ListingDraft = z.infer<typeof ListingDraftSchema>;

/** What the generate route returns: a draft plus what the user should double-check. */
export interface GeneratedListing {
  draft: Omit<ListingDraft, "price" | "imageUrls" | "categoryId"> & {
    price?: number;
    imageUrls: string[];
    categoryId: string;
  };
  categorySuggestions: { categoryId: string; categoryName: string; path: string }[];
  /** Conditions each suggested category accepts; a category not listed accepts any. */
  conditionsByCategory: Record<string, Condition[]>;
  /** Fields Claude guessed, by name: "title", "condition", "brand", ... (aspects carry their own flag). */
  guessedFields: string[];
  /** Things to verify before publishing, written by Claude. */
  checks: string[];
  warnings: string[];
}
