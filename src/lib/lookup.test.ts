import { describe, expect, it } from "vitest";
import { listingHref, type LookupResponse } from "./lookup";

const base: LookupResponse = { source: "barcode", results: { total: 0, items: [] }, notes: [] } as unknown as LookupResponse;

describe("listingHref", () => {
  it("prefers the identified title and passes the barcode", () => {
    const href = listingHref({
      ...base,
      gtin: "0045496882594",
      identification: { title: "Nintendo Switch OLED" } as LookupResponse["identification"],
    });
    expect(href).toBe("/listing?q=Nintendo+Switch+OLED&barcode=0045496882594");
  });
  it("falls back to the first eBay match", () => {
    const href = listingHref({ ...base, results: { total: 1, items: [{ title: "Lego 10294" }] } } as unknown as LookupResponse);
    expect(href).toBe("/listing?q=Lego+10294");
  });
  it("uses the album name, not the eBay listing title, for a CD", () => {
    const href = listingHref({
      ...base,
      gtin: "0724384260927",
      album: { title: "OK Computer", artist: "Radiohead", genres: [], mbid: "x" },
      results: { total: 1, items: [{ title: "RADIOHEAD OK COMPUTER CD 1997 EMI VG+ FREE SHIP" }] },
    } as unknown as LookupResponse);
    expect(href).toBe("/listing?q=Radiohead+OK+Computer&barcode=0724384260927");
  });
  it("opens an empty listing when nothing is known", () => {
    expect(listingHref(base)).toBe("/listing");
  });
});
