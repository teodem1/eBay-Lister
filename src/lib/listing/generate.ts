// Claude writes the SEO title, item specifics and description for a listing draft.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONDITIONS, nearestAllowedCondition, type CategorySuggestion, type Condition, type EbaySellClient } from "../ebay/sell";
import type { EbayConfig } from "../ebay/config";
import { conditionSummary, conditionTitleSuffix } from "./condition";
import { TITLE_MAX, type GeneratedListing, type ItemInput } from "./types";

export const MODEL = "claude-opus-5-5";

// Kept free of length limits: structured outputs don't enforce them, so we enforce in code below.
const ClaudeListingSchema = z.object({
  title: z.string().describe(`SEO title, at most ${TITLE_MAX} characters`),
  condition: z.enum(CONDITIONS),
  conditionDescription: z.string().describe("Short note on wear or defects; empty for new items"),
  brand: z.string().describe("Brand, or empty if unknown"),
  mpn: z.string().describe("Manufacturer part / model number, or empty if unknown"),
  aspects: z.array(
    z.object({
      name: z.string(),
      value: z.string().describe("Use ' | ' between several values"),
      guessed: z.boolean().describe("true if not stated in the input or certain from the barcode/model"),
    }),
  ),
  descriptionHtml: z.string(),
  packageWeightKg: z.number().describe("Estimated packed weight in kg including box and padding; 0 if no idea"),
  packageDimensionsCm: z
    .object({ length: z.number(), width: z.number(), height: z.number() })
    .describe("Estimated shipping box size in cm; zeros if no idea"),
  guessedFields: z
    .array(z.enum(["title", "condition", "conditionDescription", "brand", "mpn", "description"]))
    .describe("Top-level fields that rely on assumptions"),
  checks: z.array(z.string()).describe("Short things the seller must verify before publishing"),
});
export type ClaudeListing = z.infer<typeof ClaudeListingSchema>;

const SYSTEM = `You write eBay listings that rank well in eBay search (Cassini) and convert.

Title rules:
- At most ${TITLE_MAX} characters. Use the space: brand, model, key specs (size, capacity, colour, edition), condition word if useful.
- Put the words buyers search first. No ALL CAPS words except acronyms, no "L@@K", no emojis, no punctuation spam, no words like "wow" or "rare" unless true.
- Never invent a model number, size or spec. If unsure, leave it out of the title.
- For music, start with the artist and the album name as given in "Item" (never a seller's listing title), then format and useful specifics (year, country of pressing, label, edition).
- When the seller gives their condition, do not put any condition words in the title: the app appends the seller's grades itself.

Item specifics:
- Fill every aspect the category lists, required ones first, using eBay's usual values (e.g. "Apple", "128 GB").
- Add other relevant aspects buyers filter on.
- Mark guessed=true whenever the value is not stated by the seller and not certain from the barcode or exact model. If you have no reasonable value, give an empty string and guessed=true.

Condition: when the seller gives their condition, use exactly that condition and describe the item's condition using only the seller's words and grades: never add defects, wear or claims (like "tested") they did not state, and never use the condition of other eBay listings. Otherwise pick only from the allowed conditions listed for the category, when a list is given.

Package: estimate the packed weight and a sensible box size for shipping the item (item plus box and padding). These are always estimates.

Description (descriptionHtml):
- Simple, mobile-friendly HTML: <h2>, <p>, <ul>/<li>, <strong>. No <script>, <style>, <iframe>, forms, external links, or inline event handlers.
- Sections: short intro sentence, key features, condition, what's included, shipping note. Natural keyword use, no keyword stuffing.
- Do not claim things the seller did not say (accessories included, original box, warranty, tested working). Put those in "checks" instead.

Write the title, aspects values and description in the marketplace language given by the user.`;

export interface GenerateDeps {
  anthropic: Anthropic;
  ebay?: EbaySellClient;
  config: EbayConfig;
}

export function trimTitle(title: string, max = TITLE_MAX): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : clean.slice(0, max)).trim();
}

/** Strips what eBay rejects in descriptions (active content). Not a full HTML sanitizer. */
export function sanitizeDescription(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|input|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
}

export function makeSku(barcode?: string): string {
  const digits = barcode?.replace(/\D/g, "");
  const suffix = Date.now().toString(36).slice(-5);
  return (digits ? `BC-${digits}-${suffix}` : `ITEM-${suffix}${Math.random().toString(36).slice(2, 6)}`).toUpperCase();
}

export async function generateListing(input: ItemInput, deps: GenerateDeps): Promise<GeneratedListing> {
  const warnings: string[] = [];
  let categories: CategorySuggestion[] = [];
  let aspectHints: { name: string; required: boolean }[] = [];
  let conditionsByCategory: Record<string, Condition[]> = {};

  if (deps.ebay) {
    try {
      const treeId = await deps.ebay.getCategoryTreeId();
      categories = await deps.ebay.suggestCategories(input.query, treeId);
      if (categories[0]) aspectHints = await deps.ebay.getCategoryAspects(categories[0].categoryId, treeId);
    } catch (err) {
      warnings.push(`Could not look up the eBay category: ${(err as Error).message}`);
    }
    try {
      conditionsByCategory = await deps.ebay.getCategoryConditions(categories.map((c) => c.categoryId));
    } catch (err) {
      warnings.push(`Could not look up which conditions the category accepts: ${(err as Error).message}`);
    }
  } else {
    warnings.push("eBay keys are not set, so no category was looked up. Enter a category ID by hand.");
  }

  const sellerConditionText = input.sellerCondition ? conditionSummary(input.sellerCondition) : "";
  const userText = [
    `Marketplace: ${deps.config.marketplaceId} (write in ${deps.config.contentLanguage})`,
    `Item: ${input.query}`,
    input.barcode ? `Barcode (EAN/UPC): ${input.barcode}` : null,
    sellerConditionText ? `Seller's condition (use exactly this): ${input.sellerCondition!.condition}. ${sellerConditionText}` : null,
    input.notes
      ? `Seller notes: ${input.notes}`
      : sellerConditionText
        ? null
        : "Seller notes: none (condition unknown, treat as a guess)",
    categories[0] ? `eBay category: ${categories[0].path} (ID ${categories[0].categoryId})` : null,
    aspectHints.length
      ? `Item specifics for this category:\n${aspectHints.map((a) => `- ${a.name}${a.required ? " (required)" : ""}`).join("\n")}`
      : null,
    categories[0] && conditionsByCategory[categories[0].categoryId]
      ? `Allowed conditions for this category: ${conditionsByCategory[categories[0].categoryId].join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await deps.anthropic.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ClaudeListingSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: userText }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to write this listing. Try rewording the item description.");
  }
  const out = response.parsed_output;
  if (!out) throw new Error(`Claude returned no listing (stop reason: ${response.stop_reason}).`);

  // The seller's grades end the title ("CD: NM / Inlay: VG+"); Claude's part is trimmed to fit.
  const suffix = input.sellerCondition ? conditionTitleSuffix(input.sellerCondition) : "";
  const title = suffix ? `${trimTitle(out.title, TITLE_MAX - suffix.length - 1)} ${suffix}` : trimTitle(out.title);
  // The seller's condition wins over Claude's; it is a fact, not a guess.
  const seller = input.sellerCondition;
  const guessedFields: string[] = seller
    ? out.guessedFields.filter((f) => f !== "condition" && f !== "conditionDescription")
    : [...out.guessedFields];
  const wanted = seller?.condition ?? out.condition;
  if (categories[0]) guessedFields.push("categoryId"); // eBay's top suggestion is still a guess
  const allowed = categories[0] ? (conditionsByCategory[categories[0].categoryId] ?? []) : [];
  const condition = nearestAllowedCondition(wanted, allowed);
  if (condition !== wanted) {
    warnings.push(`eBay doesn't accept "${wanted}" in this category, so the condition was set to "${condition}".`);
    if (!guessedFields.includes("condition")) guessedFields.push("condition");
  }
  const dims = out.packageDimensionsCm;
  const hasDims = dims.length > 0 && dims.width > 0 && dims.height > 0;
  if (out.packageWeightKg > 0 || hasDims) guessedFields.push("package"); // always an estimate
  if (!input.suggestedPrice) warnings.push("No suggested price was passed in. Enter a price before publishing.");

  return {
    draft: {
      sku: makeSku(input.barcode),
      title,
      categoryId: categories[0]?.categoryId ?? "",
      categoryName: categories[0]?.path,
      condition,
      conditionDescription: (seller ? sellerConditionText : out.conditionDescription) || undefined,
      aspects: out.aspects.filter((a) => a.name.trim()),
      descriptionHtml: sanitizeDescription(out.descriptionHtml),
      price: input.suggestedPrice,
      quantity: 1,
      imageUrls: [],
      barcode: input.barcode,
      brand: out.brand || undefined,
      mpn: out.mpn || undefined,
      promotedPercent: deps.config.promotedPercent || undefined,
      bestOfferMinPercent: deps.config.bestOfferMinPercent || undefined,
      packageWeightKg: out.packageWeightKg > 0 ? Math.round(out.packageWeightKg * 100) / 100 : undefined,
      packageDimensionsCm: hasDims
        ? { length: Math.ceil(dims.length), width: Math.ceil(dims.width), height: Math.ceil(dims.height) }
        : undefined,
    },
    categorySuggestions: categories,
    conditionsByCategory,
    guessedFields,
    checks: out.checks,
    warnings,
  };
}
