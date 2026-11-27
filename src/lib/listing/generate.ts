// Claude writes the SEO title, item specifics and description for a listing draft.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONDITIONS, nearestAllowedCondition, type AspectHint, type CategorySuggestion, type Condition, type EbaySellClient } from "../ebay/sell";
import type { EbayConfig } from "../ebay/config";
import { releaseFactsText, type AlbumInfo } from "../music/musicbrainz";
import { cdKeywords } from "../pricing/version";
import { cdTitle, conditionSummary } from "./condition";
import { TITLE_MAX, type GeneratedListing, type ItemInput } from "./types";

export const MODEL = "claude-opus-5-5";

// Kept free of length limits: structured outputs don't enforce them, so we enforce in code below.
const ClaudeListingSchema = z.object({
  title: z.string().describe(`SEO title, at most ${TITLE_MAX} characters`),
  titleExtras: z
    .array(z.string())
    .describe("Graded CD only: buyer search terms to add after the album name; a rare edition phrase first (shorter forms after \"||\"), then the most searched (e.g. \"Rare Canadian Press||Rare Canada\", \"1977\", \"Atlantic\"); empty otherwise"),
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

const SYSTEM = `You write eBay listings that rank in eBay search (Cassini) and turn browsers into buyers. Follow these rules exactly. Never pad with marketing language. When a fact is missing, leave it out and flag it; never guess it.

Title: search real estate, not a headline.
- At most ${TITLE_MAX} characters, and use them: empty title space is lost search matches.
- eBay weighs the first ~40 characters most: put the exact words a buyer types first.
- Order: what it is / model, the key differentiating spec, brand, then secondary search terms to fill the space.
- Use the words buyers search, not the manufacturer's wording when they differ.
- No marketing words nobody searches: amazing, premium, must-have, best, top quality, wow, L@@K, classic, legendary, mint (unless it is the seller's grade), genuine (unless authenticity is a real search term). "Rare" only as part of a supported edition phrase (see "Rare and special editions").
- No ALL CAPS words (except acronyms like CD, UK, LP), no "!!!", no emojis, no symbol spam: eBay can suppress them.
- Never invent a model number, size or spec. If unsure, leave it out of the title.
- For music, start with the artist and the album name as given in "Item" (never a seller's listing title), then format and useful specifics (year, country of pressing, label, edition).
- A graded CD (the seller gives their condition): "title" is ONLY the artist and the album name as given in "Item", e.g. "Genesis Wind & Wuthering". The app adds " CD (Disc: ... / Inlay: ...)" itself, which leaves about 15 characters. Fill them with "titleExtras": short buyer search terms, most searched first, only facts from "Item", "Release facts" or the item specifics you are certain of. Good extras: "2CD" (or "3CD") for a multi-disc set, the original release year, the record label, "Canada" for a Canadian pressing, "Remastered", "Deluxe Edition", "Import", "Soundtrack", a specific style buyers search (e.g. "Prog Rock", "Blues"; not a broad word like "Rock" or "Music"). Never a condition word, "CD", or a word already in the title.
- No-barcode pressing: when photos are given and the back cover (or back inlay) is clearly visible and has NO barcode printed anywhere, this is a no-barcode pressing, usually an early CD issue that collectors look for. Its edition phrase is "Rare No Barcode||No Barcode" (with "Early Press" when the label or design says 1980s, e.g. "Rare No Barcode Early Press||Rare No Barcode||No Barcode"), say "no barcode on the back cover" in the description, and add "Features: No Barcode" only if eBay lists that value. Only when you can see the whole back cover; if it is cropped, blurry or missing, add a check instead ("Confirm the back cover has no barcode").
- Rare and special editions: collectors search for them and they make a listing stand out, so when the CD is one, its edition phrase is the FIRST title extra, before the year or label. Examples: "Rare Canadian Press", "Rare Promo", "Limited Edition", "Numbered Edition", "Japan Import", "First Press", "Club Edition", "Out of Print", "Rare Digipak". Only when a fact supports it: the seller's notes or current title say so (e.g. "RARE CANADIAN VERSION" becomes "Rare Canadian Press"), the release facts show an uncommon pressing (a Canadian, promo, limited, numbered or club pressing), or the item text names the edition. Space is short, so give the phrase in shorter forms too, separated by "||", longest first: "Rare Canadian Press||Rare Canada||Canada". Write "Rare" at most once, never on its own and never without a supporting fact. When nothing supports it, add no edition phrase. Name the edition in the description's summary line and Key features as well.

Item specifics: fill every applicable one.
- Fill every aspect listed for the category, required ones first, and also the optional ones most sellers skip (e.g. for a CD: Artist, Release Title, Format, Genre, Style, Record Label, Release Year, Country/Region of Manufacture, Edition, Language, Type, Number of Discs, Catalog Number, Case Type, Features, Producer). An empty field is a lost filter match.
- When eBay lists values for an aspect, use one of those values exactly (spelling and case), so eBay's filters match. Only "Release facts" and the barcode count as certain for a CD's pressing (label, country, year, catalog number).
- Values must mean what the aspect means: Style is a musical style ("Progressive Rock"), never a decade (that is Era); Type is what eBay lists (Album, Live, Compilation, Single...). Skip Unit Quantity and Unit Type. Use one name per field (e.g. not both "Catalog Number" and "Catalogue Number"; use the category's spelling).
- Never invent a value. Mark guessed=true whenever the value is not stated in the input and not certain from the barcode, release facts or exact model. If you have no reasonable value, give an empty string with guessed=true and add a short check (e.g. "Confirm the catalog number from the spine").

Condition: honest and plain beats conversion tricks. When the seller gives their condition, use exactly that condition and describe the item's condition using only the seller's words and grades: never add defects, wear or claims (like "tested") they did not state, never soften or upsell them ("great condition!"), and never use the condition of other eBay listings. Otherwise pick only from the allowed conditions listed for the category, when a list is given.

Description (descriptionHtml): scannable, factual, for a buyer skimming on a phone. No walls of text, no adjectives doing a fact's work.
- Simple, mobile-friendly HTML: <h2>, <p>, <ul>/<li>, <strong>. No <script>, <style>, <iframe>, tables, forms, external links, or inline event handlers.
- In this order:
  1. One-line summary <p>: what it is (for a CD: artist, album, format, and pressing when known).
  2. <h2>Key features</h2>: short bullets, one fact per line (for a CD: release year, label, number of discs, edition or remaster, genre). Only facts you are sure of.
  3. <h2>Specifications</h2>: a bullet list mirroring the filled item specifics as "<strong>Name:</strong> value". Leave out empty ones.
  4. <h2>Condition</h2>: precise and honest, only the seller's words and grades (for a CD: disc, inlay/booklet, case, tested, defects).
  5. <h2>What's included</h2>: only what the seller's condition says is there (for a CD: the disc, plus the inlay/booklet and case unless the seller says they are missing). Never add things not stated (obi, stickers, original shrink wrap, extras).
  6. <h2>Shipping</h2>: the seller ships only to Canada and the United States. Say exactly that; never mention international or worldwide shipping. Also say that buying more than one item (for a CD: "more than one CD") combines shipping into one package, so the buyer pays shipping once on the total weight.
- Do not claim things the seller did not say (accessories included, original box, warranty, tested working). Put those in "checks" instead.

Checks: at most 4 short open questions for the seller, the ones that matter most to a buyer first (e.g. a pressing fact you could not confirm, a remaster or reissue question). Never ask about the language, the case grade or the case type of a standard CD. Plus for a CD with defects in the seller's notes: "Add a close-up photo of each defect (it prevents disputes)".

Price: only when "Price evidence" is given. Pick the item price (shipping is charged separately) that should sell within a few weeks for the most money: weigh sold copies above asking prices, copies in the seller's condition above others, recent sales above old ones, and compare totals with shipping since buyers do. Stay inside the allowed range given. Give the reason in one short sentence (e.g. "Near mint copies sold for $16-19 in the last 3 months"). Without price evidence, price is 0 and priceReason is empty.

Write the title, aspects values and description in the marketplace language given by the user.`;

export interface GenerateDeps {
  anthropic: Anthropic;
  /** Looks up the exact pressing for a barcode (MusicBrainz). Its facts go to Claude as certain. */
  albumFacts?: (barcode: string) => Promise<AlbumInfo | null>;
  ebay?: EbaySellClient;
  config: EbayConfig;
}

/** One aspect for Claude: "- Format (required) [one of: CD, Vinyl, ...]". */
export function aspectLine(a: AspectHint): string {
  const tag = a.required ? " (required)" : "";
  if (!a.values?.length) return `- ${a.name}${tag}`;
  return `- ${a.name}${tag} [${a.selectionOnly ? "only" : "eBay values, use one when it fits"}: ${a.values.join(", ")}]`;
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
  let aspectHints: AspectHint[] = [];
  let conditionsByCategory: Record<string, Condition[]> = {};

  if (deps.ebay) {
    try {
      const treeId = await deps.ebay.getCategoryTreeId();
      categories = input.categoryId
        ? [{ categoryId: input.categoryId, categoryName: "", path: `the listing's category (ID ${input.categoryId})` }]
        : cdCategoryFirst(await deps.ebay.suggestCategories(cdKeywords(input.query), treeId));
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

  // The exact pressing (label, country, year) makes the title and item specifics facts, not guesses.
  let album: AlbumInfo | null = null;
  if (input.barcode && deps.albumFacts) {
    try {
      album = await deps.albumFacts(input.barcode);
    } catch {
      album = null; // MusicBrainz is a bonus; never block the listing on it
    }
  }

  // No barcode scanned: Claude checks the photos for a no-barcode (early) pressing.
  const photos = (input.barcode ? [] : (input.imageUrls ?? []))
    .filter((u) => /^https:\/\//.test(u))
    .slice(0, 3)
    .map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));

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
    album ? `Release facts (MusicBrainz, for this barcode; certain):\n${releaseFactsText(album)}` : null,
    aspectHints.length ? `Item specifics for this category:\n${aspectHints.map(aspectLine).join("\n")}` : null,
    photos.length
      ? `Photos: ${photos.length} photo(s) of the seller's copy follow (front cover first, then the back). No barcode was scanned for this CD.`
      : null,
    input.canadianVersion
      ? 'Canadian version: the seller bought this copy in Canada, and sold copies titled "Canadian" sold for more than the others. Make "Canadian Version" the edition phrase, the first title extra (forms "Canadian Version||Canadian||Canada", with "Rare " in front only when another fact says rare), and name it in the description summary. Do not set Country/Region of Manufacture from this.'
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
    messages: [{ role: "user", content: photos.length ? [{ type: "text", text: userText }, ...photos] : userText }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to write this listing. Try rewording the item description.");
  }
  const out = response.parsed_output;
  if (!out) throw new Error(`Claude returned no listing (stop reason: ${response.stop_reason}).`);

  // A graded CD gets the seller's title template: "Artist Album CD (Disc: Near Mint / Inlay: Near Mint)".
  const title = input.sellerCondition
    ? cdTitle(out.title, input.sellerCondition, TITLE_MAX, out.titleExtras ?? [])
    : trimTitle(out.title);
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
      categoryName: categories[0]?.categoryName ? categories[0].path : undefined,
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
