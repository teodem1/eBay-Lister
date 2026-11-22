// Claude writes the SEO title, item specifics and description for a listing draft.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONDITIONS, type CategorySuggestion, type EbaySellClient } from "../ebay/sell";
import type { EbayConfig } from "../ebay/config";
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

Item specifics:
- Fill every aspect the category lists, required ones first, using eBay's usual values (e.g. "Apple", "128 GB").
- Add other relevant aspects buyers filter on.
- Mark guessed=true whenever the value is not stated by the seller and not certain from the barcode or exact model. If you have no reasonable value, give an empty string and guessed=true.

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

  if (deps.ebay) {
    try {
      const treeId = await deps.ebay.getCategoryTreeId();
      categories = await deps.ebay.suggestCategories(input.query, treeId);
      if (categories[0]) aspectHints = await deps.ebay.getCategoryAspects(categories[0].categoryId, treeId);
    } catch (err) {
      warnings.push(`Could not look up the eBay category: ${(err as Error).message}`);
    }
  } else {
    warnings.push("eBay keys are not set, so no category was looked up. Enter a category ID by hand.");
  }

  const userText = [
    `Marketplace: ${deps.config.marketplaceId} (write in ${deps.config.contentLanguage})`,
    `Item: ${input.query}`,
    input.barcode ? `Barcode (EAN/UPC): ${input.barcode}` : null,
    input.notes ? `Seller notes: ${input.notes}` : "Seller notes: none (condition unknown, treat as a guess)",
    categories[0] ? `eBay category: ${categories[0].path} (ID ${categories[0].categoryId})` : null,
    aspectHints.length
      ? `Item specifics for this category:\n${aspectHints.map((a) => `- ${a.name}${a.required ? " (required)" : ""}`).join("\n")}`
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

  const title = trimTitle(out.title);
  const guessedFields: string[] = [...out.guessedFields];
  if (categories[0]) guessedFields.push("categoryId"); // eBay's top suggestion is still a guess
  if (!input.suggestedPrice) warnings.push("No suggested price was passed in. Enter a price before publishing.");

  return {
    draft: {
      sku: makeSku(input.barcode),
      title,
      categoryId: categories[0]?.categoryId ?? "",
      categoryName: categories[0]?.path,
      condition: out.condition,
      conditionDescription: out.conditionDescription || undefined,
      aspects: out.aspects.filter((a) => a.name.trim()),
      descriptionHtml: sanitizeDescription(out.descriptionHtml),
      price: input.suggestedPrice,
      quantity: 1,
      imageUrls: [],
      barcode: input.barcode,
      brand: out.brand || undefined,
      mpn: out.mpn || undefined,
    },
    categorySuggestions: categories,
    guessedFields,
    checks: out.checks,
    warnings,
  };
}
