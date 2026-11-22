import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { getEbayConfig } from "../ebay/config";
import type { EbaySellClient } from "../ebay/sell";
import { generateListing, sanitizeDescription, trimTitle, type ClaudeListing } from "./generate";

const config = getEbayConfig({});

const claudeOut: ClaudeListing = {
  title: "Nintendo Switch OLED Blanche 64 Go Console Portable Complète Boîte Manettes Joy-Con Dock HDMI Très Bon",
  condition: "USED_VERY_GOOD",
  conditionDescription: "",
  brand: "Nintendo",
  mpn: "",
  aspects: [
    { name: "Marque", value: "Nintendo", guessed: false },
    { name: "Couleur", value: "Blanc", guessed: true },
  ],
  descriptionHtml: '<p onclick="x()">Bonne console</p><script>alert(1)</script>',
  guessedFields: ["condition"],
  checks: ["Confirm the original box is included"],
};

function fakeAnthropic(parsed: ClaudeListing | null, stop_reason = "end_turn") {
  const parse = vi.fn().mockResolvedValue({ parsed_output: parsed, stop_reason });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("generateListing", () => {
  it("builds a draft from Claude's output and eBay's category", async () => {
    const { client, parse } = fakeAnthropic(claudeOut);
    const ebay = {
      getCategoryTreeId: vi.fn().mockResolvedValue("71"),
      suggestCategories: vi
        .fn()
        .mockResolvedValue([{ categoryId: "139971", categoryName: "Consoles", path: "Jeux vidéo > Consoles" }]),
      getCategoryAspects: vi.fn().mockResolvedValue([{ name: "Marque", required: true }]),
    } as unknown as EbaySellClient;

    const out = await generateListing(
      { query: "switch oled", barcode: "0045496453435", suggestedPrice: 250 },
      { anthropic: client, ebay, config },
    );

    expect(out.draft.title.length).toBeLessThanOrEqual(80);
    expect(out.draft.categoryId).toBe("139971");
    expect(out.draft.price).toBe(250);
    expect(out.draft.descriptionHtml).toBe("<p>Bonne console</p>");
    expect(out.draft.sku).toMatch(/^BC-0045496453435-/);
    expect(out.guessedFields).toEqual(["condition", "categoryId"]);
    expect(out.warnings).toEqual([]);

    const req = parse.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.messages[0].content).toContain("Marque (required)");
    expect(req.messages[0].content).toContain("fr-FR");
  });

  it("still works without eBay keys and warns", async () => {
    const { client } = fakeAnthropic(claudeOut);
    const out = await generateListing({ query: "switch" }, { anthropic: client, config });
    expect(out.draft.categoryId).toBe("");
    expect(out.warnings.join(" ")).toMatch(/category/);
    expect(out.warnings.join(" ")).toMatch(/price/);
  });

  it("throws a readable error on refusal", async () => {
    const { client } = fakeAnthropic(null, "refusal");
    await expect(generateListing({ query: "x" }, { anthropic: client, config })).rejects.toThrow(/declined/);
  });
});

describe("trimTitle / sanitizeDescription", () => {
  it("cuts at a word boundary within 80 chars", () => {
    const t = trimTitle("a".repeat(70) + " bbbbbbbbbbbbbbb");
    expect(t).toBe("a".repeat(70));
    expect(trimTitle("  short   title ")).toBe("short title");
  });

  it("removes active content", () => {
    expect(sanitizeDescription('<a href="javascript:x">y</a><iframe src="z"></iframe>')).toBe('<a href="x">y</a>');
  });
});
