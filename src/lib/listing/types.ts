// Shared shapes for the listing draft that the review screen edits and the publish route sends to eBay.
import { z } from "zod";
import { CONDITIONS, type Condition } from "../ebay/sell";
import { SellerConditionSchema } from "./conditionSchema";
import type { Edition } from "../pricing/edition";

export { TITLE_MAX } from "./limits";
import { TITLE_MAX } from "./limits";

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
  /** The seller's own condition. When given, it sets the eBay condition and condition text. */
  sellerCondition: SellerConditionSchema.optional(),
  /** Sold and current prices as text (Auto tab): Claude then picks the price too. */
  priceEvidence: z.string().max(8000).optional(),
  /** Copies titled Canadian sold for more, and the seller's copy was bought in Canada: say "Canadian Version". */
  canadianVersion: z.boolean().optional(),
  /** Photos of the CD (front cover first, then back). Sent when no barcode was scanned, to spot a no-barcode pressing. */
  imageUrls: z.array(z.url()).max(4).optional(),
  /** An existing listing's eBay category: used as is instead of eBay's suggestion. */
  categoryId: z.string().regex(/^\d+$/).optional(),
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
  /** Best Offer: offers under this % of the price are declined; 0 = off. Unset uses EBAY_BEST_OFFER_MIN_PERCENT. */
  bestOfferMinPercent: z.number().min(0).max(99).optional(),
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
  /** Claude's price pick, only when price evidence was sent. */
  claudePrice?: { price: number; reason: string };
  /** The copy's special edition (no barcode, Canadian...), when Claude found one; prices it from that edition's sales. */
  edition?: Exclude<Edition, "none">;
}

// Shapes screens use from server modules, re-exported as types only, so screens
// import them from here and never pull in zod, the Claude SDK or the eBay client.
export type { ShelfCd } from "../identify/shelf";
export type { ApplyResult, LiveListing, RefreshPreview } from "../ebay/refreshListings";
export type { PriceCheck } from "../pricing/priceCheck";
export type { BatchIndex, BatchRun, EngagementLevel, EntryStatus, IndexEntry, Proposal } from "../liveBatch/types";
