import { describe, expect, it } from "vitest";
import { detailsFromTitle, htmlToText, itemDetailsRequest, originFromText, toItemDetails } from "./itemDetails";

describe("itemDetailsRequest", () => {
  it("uses getItem for RESTful ids and the legacy lookup for item numbers", () => {
    expect(itemDetailsRequest("v1|1234567|0")?.path).toBe("/buy/browse/v1/item/v1%7C1234567%7C0");
    expect(itemDetailsRequest("168415872667")).toEqual({
      path: "/buy/browse/v1/item/get_item_by_legacy_id",
      params: { legacy_item_id: "168415872667" },
    });
    expect(itemDetailsRequest("../x")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("drops tags, scripts and entities and keeps line breaks", () => {
    expect(htmlToText("<style>a{}</style><p>Disc: NM&nbsp;&amp; clean</p><p>Ships fast</p>")).toBe(
      "Disc: NM & clean\nShips fast",
    );
  });
  it("shortens long text on a word", () => {
    expect(htmlToText("one two three four", 9)).toBe("one two…");
  });
});

describe("toItemDetails", () => {
  it("reads grades from the seller's condition notes and origin from item specifics", () => {
    const d = toItemDetails({
      title: "Genesis Wind & Wuthering CD",
      condition: "Very Good",
      conditionDescription: "Disc is near mint, light scuffs. Inlay: VG+ with small crease.",
      description: "<p>Great album</p>",
      localizedAspects: [{ name: "Country/Region of Manufacture", value: "Canada" }],
      itemLocation: { country: "CA" },
      image: { imageUrl: "https://i.ebayimg.com/a/s-l225.jpg" },
      itemWebUrl: "https://www.ebay.ca/itm/1",
    });
    expect(d).toMatchObject({
      available: true,
      disc: "Near mint",
      inlay: "VG+ with small crease",
      origin: "Canada",
      shipsFrom: "CA",
      description: "Great album",
      images: ["https://i.ebayimg.com/a/s-l225.jpg"],
    });
  });

  it("prefers graded item specifics and ignores text that is not a grade", () => {
    const d = toItemDetails({
      title: "Genesis - Wind CD - Atlantic",
      localizedAspects: [{ name: "Case Condition", value: "Cracked" }],
    });
    expect(d.inlay).toBe("Cracked");
    expect(d.disc).toBeNull();
    expect(d.origin).toBeNull();
  });
});

describe("title fallbacks", () => {
  it("reads grades and pressing country from a title", () => {
    expect(detailsFromTitle("Genesis Wind & Wuthering Canadian pressing CD: NM / Inlay: VG")).toEqual({
      disc: "NM",
      inlay: "VG",
      origin: "Canada",
    });
    expect(originFromText("Made in Japan")).toBe("Japan");
  });
});
