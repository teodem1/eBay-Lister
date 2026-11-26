// Claude writes the SEO title, item specifics and description for a listing draft.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONDITIONS, nearestAllowedCondition, type CategorySuggestion, type Condition, type EbaySellClient } from "../ebay/sell";
import type { EbayConfig } from "../ebay/config";
import { cdKeywords } from "../pricing/version";
import { cdTitle, conditionSummary } from "./condition";
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
  price: z.number().describe("Only when price evidence is given: the item price to list at; otherwise 0"),
  priceReason: z.string().describe("Only when price evidence is given: one short sentence on why; otherwise empty"),
  discCount: z.number().describe("For a CD: how many discs (2 for a double album or 2CD set); 1 if unsure or not a CD"),
  doubleJewelCase: z
    .boolean()
    .describe("For a multi-disc CD: true if it comes in a double (fat) jewel case or one jewel case per disc; false if the discs share a standard-size case, or unsure"),
});
/** Default packed weight of a single CD in its jewel case and mailer: 115 g. */
export const DEFAULT_PACKAGE_WEIGHT_KG = 0.115;
/** Each extra disc in the same case adds a bare CD. */
export const EXTRA_DISC_KG = 0.016;
/** Each extra disc in a double (fat) jewel case adds a whole CD with its case (a double jewel box ships at 230 g). */
export const EXTRA_DISC_WITH_CASE_KG = 0.115;

/** How many discs: Claude's count, else what the item text says ("2CD", "2 x CD", "double CD", "3 discs"), else 1. */
export function discCount(claude: number | undefined, text: string): number {
  if (claude !== undefined && Number.isInteger(claude) && claude >= 1 && claude <= 20) {
    if (claude > 1) return claude;
  }
  const t = text.toLowerCase();
  const m = /\b(\d{1,2})\s*(?:x\s*)?[- ]?(?:cds?|discs?|disques?)\b/.exec(t) ?? /\b(\d{1,2})cd\b/.exec(t);
  const n = m ? Number(m[1]) : NaN;
  if (n >= 2 && n <= 20) return n;
  if (/\b(double|2-disc|deux disques)\b/.test(t)) return 2;
  return 1;
}

/** A double (fat) jewel case, from Claude or the item text. */
export function hasDoubleJewelCase(claude: boolean | undefined, text: string): boolean {
  return !!claude || /\b(double|fat)[- ]?(jewel)?[- ]?(case|box)\b|\bfatbox\b/i.test(text);
}

/**
 * Default packed weight: 115 g for a CD, plus a bare disc (16 g) for each extra
 * disc in the same case, or a whole CD with its case (115 g) each in a double jewel case.
 */
export function packageWeightKg(discs: number, doubleCase = false): number {
  const extra = Math.max(0, discs - 1) * (doubleCase ? EXTRA_DISC_WITH_CASE_KG : EXTRA_DISC_KG);
  return Math.round((DEFAULT_PACKAGE_WEIGHT_KG + extra) * 1000) / 1000;
}

/** Default package size in cm (a CD mailer): 12 long, 15 wide, 2.5 thick. */
export const DEFAULT_PACKAGE_CM = { length: 12, width: 15, height: 2.5 } as const;

export type ClaudeListing = z.infer<typeof ClaudeListingSchema>;

const SYSTEM = `You write eBay listings that rank well in eBay search (Cassini) and convert.

Title rules:
- At most ${TITLE_MAX} characters. Use the space: brand, model, key specs (size, capacity, colour, edition), condition word if useful.
- Put the words buyers search first. No ALL CAPS words except acronyms, no "L@@K", no emojis, no punctuation spam, no words like "wow" or "rare" unless true.
- Never invent a model number, size or spec. If unsure, leave it out of the title.
- For music, start with the artist and the album name as given in "Item" (never a seller's listing title), then format and useful specifics (year, country of pressing, label, edition).
- When the seller gives their condition (a CD), the title is ONLY the artist and the album name as given in "Item", e.g. "Genesis Wind & Wuthering": no label, genre, year, format or condition words. The app adds " CD (Disc: ... / Inlay: ...)" itself.

Item specifics:
- Fill every aspect the category lists, required ones first, using eBay's usual values (e.g. "Apple", "128 GB").
- Add other relevant aspects buyers filter on.
- Mark guessed=true whenever the value is not stated by the seller and not certain from the barcode or exact model. If you have no reasonable value, give an empty string and guessed=true.

Condition: when the seller gives their condition, use exactly that condition and describe the item's condition using only the seller's words and grades: never add defects, wear or claims (like "tested") they did not state, and never use the condition of other eBay listings. Otherwise pick only from the allowed conditions listed for the category, when a list is given.

Description (descriptionHtml):
- Simple, mobile-friendly HTML: <h2>, <p>, <ul>/<li>, <strong>. No <script>, <style>, <iframe>, forms, external links, or inline event handlers.
- Sections: short intro sentence, key features, condition, what's included, shipping note. Natural keyword use, no keyword stuffing.
- Shipping note: the seller ships only to Canada and the United States. Say exactly that; never mention international or worldwide shipping.
- Combined shipping: also say that buying more than one item (for a CD: "more than one CD") combines shipping into one package, so the buyer pays shipping once on the total weight.
- Do not claim things the seller did not say (accessories included, original box, warranty, tested working). Put those in "checks" instead.

Price: only when "Price evidence" is given. Pick the item price (shipping is charged separately) that should sell within a few weeks for the most money: weigh sold copies above asking prices, copies in the seller's condition above others, recent sales above old ones, and compare totals with shipping since buyers do. Stay inside the allowed range given. Give the reason in one short sentence (e.g. "Near mint copies sold for $16-19 in the last 3 months"). Without price evidence, price is 0 and priceReason is empty.

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

/**
 * The seller lists CDs: search categories as a CD and put Music > CDs first, so
 * eBay's suggestion doesn't land in Records (vinyl) and refuse the CD conditions.
 */
export function cdCategoryFirst(categories: CategorySuggestion[]): CategorySuggestion[] {
  const i = categories.findIndex((c) => /^CDs?$/i.test(c.categoryName));
  return i > 0 ? [categories[i], ...categories.slice(0, i), ...categories.slice(i + 1)] : categories;
}

export async function generateListing(input: ItemInput, deps: GenerateDeps): Promise<GeneratedListing> {
  const warnings: string[] = [];
  let categories: CategorySuggestion[] = [];
  let aspectHints: { name: string; required: boolean }[] = [];
  let conditionsByCategory: Record<string, Condition[]> = {};

  if (deps.ebay) {
    try {
      const treeId = await deps.ebay.getCategoryTreeId();
      categories = cdCategoryFirst(await deps.ebay.suggestCategories(cdKeywords(input.query), treeId));
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
    input.priceEvidence ? `Price evidence:\n${input.priceEvidence}` : null,
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

  // A graded CD gets the seller's title template: "Artist Album CD (Disc: Near Mint / Inlay: Near Mint)".
  const title = input.sellerCondition ? cdTitle(out.title, input.sellerCondition, TITLE_MAX) : trimTitle(out.title);
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
      packageWeightKg: packageWeightKg(
        discCount(out.discCount, [input.query, title].filter(Boolean).join(" ")),
        hasDoubleJewelCase(out.doubleJewelCase, [input.query, title].filter(Boolean).join(" ")),
      ),
      // The seller's standard CD mailer size; editable on the review step.
      packageDimensionsCm: { ...DEFAULT_PACKAGE_CM },
    },
    categorySuggestions: categories,
    conditionsByCategory,
    guessedFields,
    checks: out.checks,
    warnings,
    claudePrice:
      input.priceEvidence && Number.isFinite(out.price) && out.price > 0
        ? { price: Math.round(out.price * 100) / 100, reason: (out.priceReason ?? "").trim() }
        : undefined,
  };
}
