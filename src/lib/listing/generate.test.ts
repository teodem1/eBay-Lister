import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { getEbayConfig } from "../ebay/config";
import type { EbaySellClient } from "../ebay/sell";
import { aspectLine, cdCategoryFirst, discCount, hasDoubleJewelCase, packageWeightKg, generateListing, sanitizeDescription, trimTitle, type ClaudeListing } from "./generate";

const config = getEbayConfig({});

const claudeOut: ClaudeListing = {
  titleExtras: [],
  edition: "none",
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
  price: 0,
  priceReason: "",
  discCount: 1,
  doubleJewelCase: false,
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
      getCategoryConditions: vi.fn().mockResolvedValue({}),
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
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.messages[0].content).toContain("Marque (required)");
    expect(req.messages[0].content).toContain("en-CA");
    expect(JSON.stringify(req.system)).toContain("combines shipping into one package");
    // The listing rules are cached so a batch pays full price for them once.
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("swaps a condition the category refuses and uses the default package", async () => {
    const { client, parse } = fakeAnthropic({
      ...claudeOut,
      condition: "USED_GOOD",
      guessedFields: [],
    });
    const ebay = {
      getCategoryTreeId: vi.fn().mockResolvedValue("2"),
      suggestCategories: vi
        .fn()
        .mockResolvedValue([{ categoryId: "117042", categoryName: "Controllers", path: "Video Games > Controllers" }]),
      getCategoryAspects: vi.fn().mockResolvedValue([]),
      getCategoryConditions: vi.fn().mockResolvedValue({ "117042": ["NEW", "USED_EXCELLENT", "FOR_PARTS_OR_NOT_WORKING"] }),
    } as unknown as EbaySellClient;

    const out = await generateListing({ query: "pro controller" }, { anthropic: client, ebay, config });

    expect(out.draft.condition).toBe("USED_EXCELLENT");
    expect(out.guessedFields).toContain("condition");
    expect(out.warnings.join(" ")).toMatch(/USED_GOOD/);
    expect(out.conditionsByCategory["117042"]).toHaveLength(3);
    expect(out.draft.packageWeightKg).toBe(0.115);
    expect(out.draft.packageDimensionsCm).toEqual({ length: 12, width: 15, height: 2.5 });
    expect(parse.mock.calls[0][0].messages[0].content).toContain("Allowed conditions for this category: NEW, USED_EXCELLENT");
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
  it("uses the seller's condition, not Claude's guess", async () => {
    const { client, parse } = fakeAnthropic({ ...claudeOut, condition: "USED_GOOD", conditionDescription: "Some scratches" });
    const out = await generateListing(
      {
        query: "Radiohead OK Computer CD",
        sellerCondition: { condition: "USED_VERY_GOOD", disc: "Near mint", case: "Very good", booklet: "Very good+", tested: true },
      },
      { anthropic: client, config },
    );
    expect(out.draft.title.endsWith(" CD (Disc: Near Mint / Inlay: Very Good+)")).toBe(true);
    expect(out.draft.title.length).toBeLessThanOrEqual(80);
    expect(out.draft.condition).toBe("USED_VERY_GOOD");
    expect(out.draft.conditionDescription).toBe(
      "Disc: near mint. Inlay / booklet: very good+. Case: very good. Tested: plays through without skips.",
    );
    expect(out.guessedFields).not.toContain("condition");
    const text = parse.mock.calls[0][0].messages[0].content as string;
    expect(text).toContain("Seller's condition (use exactly this): USED_VERY_GOOD. Disc: near mint.");
    expect(text).not.toContain("condition unknown");
  });
});

describe("cdCategoryFirst", () => {
  it("puts Music > CDs ahead of Records", () => {
    const rec = { categoryId: "176985", categoryName: "Records", path: "Music > Records" };
    const cd = { categoryId: "176984", categoryName: "CDs", path: "Music > CDs" };
    expect(cdCategoryFirst([rec, cd]).map((c) => c.categoryId)).toEqual(["176984", "176985"]);
    expect(cdCategoryFirst([rec])).toEqual([rec]);
  });
});

describe("generateListing price pick", () => {
  it("returns Claude's price only when price evidence was sent", async () => {
    const out = { ...claudeOut, price: 17.499, priceReason: "Near mint copies sold for $16-19" };
    const { client, parse } = fakeAnthropic(out);
    const withEvidence = await generateListing(
      { query: "Genesis Wind & Wuthering", priceEvidence: "Sold copies: ..." },
      { anthropic: client, config },
    );
    expect(withEvidence.claudePrice).toEqual({ price: 17.5, reason: "Near mint copies sold for $16-19" });
    expect(JSON.stringify(parse.mock.calls[0][0].messages)).toContain("Price evidence");
    const without = await generateListing({ query: "Genesis Wind & Wuthering" }, { anthropic: fakeAnthropic(out).client, config });
    expect(without.claudePrice).toBeUndefined();
  });
});

describe("weight per disc", () => {
  it("counts discs from Claude or the item text", () => {
    expect(discCount(2, "Pink Floyd The Wall")).toBe(2);
    expect(discCount(1, "Pink Floyd The Wall 2CD")).toBe(2);
    expect(discCount(undefined, "Beatles White Album 2 x CD")).toBe(2);
    expect(discCount(1, "Genesis Live double CD")).toBe(2);
    expect(discCount(1, "Box set 3 discs")).toBe(3);
    expect(discCount(1, "Pink Floyd Meddle CD")).toBe(1);
    expect(discCount(1, "Greatest Hits of 1999 CD")).toBe(1);
    // A number in the album name is not a disc count (titles always end "CD (Disc: ...)").
    expect(discCount(1, "Adele 19 Adele 19 CD (Disc: Near Mint / Inlay: Near Mint)")).toBe(1);
    expect(discCount(undefined, "Blur 13 CD (Disc: Very Good / Inlay: Good)")).toBe(1);
    expect(discCount(1, "Chicago 17 1984 Full Moon Canada CD (Disc: Near Mint / Inlay: Near Mint)")).toBe(1);
    expect(discCount(undefined, "Beatles Anthology 2 CDs")).toBe(2);
    expect(discCount(undefined, "Clash London Calling 2-CD")).toBe(2);
    expect(discCount(undefined, "Prince Hits 2 CD set")).toBe(2);
    expect(discCount(undefined, "Box 4-disc")).toBe(4);
  });
  it("adds a bare disc per extra CD, or a disc and a case in a double jewel case", () => {
    expect(packageWeightKg(1)).toBe(0.115);
    expect(packageWeightKg(2)).toBe(0.131);
    expect(packageWeightKg(2, true)).toBe(0.23);
    expect(hasDoubleJewelCase(false, "2CD set in fatbox")).toBe(true);
    expect(hasDoubleJewelCase(false, "Live double jewel case")).toBe(true);
    expect(hasDoubleJewelCase(false, "Live double CD")).toBe(false);
  });
});

describe("listing rules from the eBay listing skill", () => {
  it("adds search terms to a graded CD title and gives Claude the pressing and eBay's values", async () => {
    const { client, parse } = fakeAnthropic({ ...claudeOut, title: "Genesis Wind & Wuthering", titleExtras: ["1977", "Canada"] });
    const ebay = {
      getCategoryTreeId: vi.fn().mockResolvedValue("2"),
      suggestCategories: vi.fn(),
      getCategoryAspects: vi.fn().mockResolvedValue([
        { name: "Artist", required: true },
        { name: "Format", required: false, values: ["CD", "Vinyl"], selectionOnly: true },
      ]),
      getCategoryConditions: vi.fn().mockResolvedValue({}),
    } as unknown as EbaySellClient;
    const albumFacts = vi.fn().mockResolvedValue({
      title: "Wind & Wuthering",
      artist: "Genesis",
      genres: ["progressive rock"],
      mbid: "x",
      release: { label: "Atlantic", country: "CA", date: "1977" },
    });
    const out = await generateListing(
      {
        query: "Genesis Wind & Wuthering",
        barcode: "075678154323",
        categoryId: "176984",
        sellerCondition: { condition: "LIKE_NEW", disc: "Near mint", booklet: "Near mint" },
      },
      { anthropic: client, ebay, config, albumFacts },
    );
    expect(out.draft.title).toBe("Genesis Wind & Wuthering 1977 Canada CD (Disc: Near Mint / Inlay: Near Mint)");
    expect(out.draft.categoryId).toBe("176984");
    expect(ebay.suggestCategories).not.toHaveBeenCalled();
    expect(albumFacts).toHaveBeenCalledWith("075678154323");
    const text = parse.mock.calls[0][0].messages[0].content as string;
    expect(text).toContain("Record label: Atlantic");
    expect(text).toContain("Country of release: Canada");
    expect(text).toContain("- Format [only: CD, Vinyl]");
    const system = JSON.stringify(parse.mock.calls[0][0].system);
    expect(system).toContain("first ~40 characters");
    expect(system).toContain("must-have");
    expect(system).toContain("What's included");
  });

  it("shows Claude the photos only when no barcode was scanned", async () => {
    const { client, parse } = fakeAnthropic(claudeOut);
    await generateListing(
      { query: "U2 War", imageUrls: ["https://i.ebayimg.com/front.jpg", "https://i.ebayimg.com/back.jpg"] },
      { anthropic: client, config },
    );
    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content).toHaveLength(3);
    expect(content[0].text).toContain("No barcode was scanned");
    expect(content[2]).toEqual({ type: "image", source: { type: "url", url: "https://i.ebayimg.com/back.jpg" } });
    expect(JSON.stringify(parse.mock.calls[0][0].system)).toContain("Rare No Barcode");

    const withBarcode = fakeAnthropic(claudeOut);
    await generateListing(
      { query: "U2 War", barcode: "042281127528", imageUrls: ["https://i.ebayimg.com/front.jpg"] },
      { anthropic: withBarcode.client, config },
    );
    expect(typeof withBarcode.parse.mock.calls[0][0].messages[0].content).toBe("string");
  });

  it("keeps listing when the MusicBrainz lookup fails", async () => {
    const { client } = fakeAnthropic(claudeOut);
    const albumFacts = vi.fn().mockRejectedValue(new Error("timeout"));
    const out = await generateListing({ query: "x", barcode: "123456789012" }, { anthropic: client, config, albumFacts });
    expect(out.draft.title).toBeTruthy();
  });

  it("writes an aspect line with eBay's values", () => {
    expect(aspectLine({ name: "Genre", required: false, values: ["Rock", "Pop"] })).toBe(
      "- Genre [eBay values, use one when it fits: Rock, Pop]",
    );
    expect(aspectLine({ name: "Artist", required: true })).toBe("- Artist (required)");
  });
});
