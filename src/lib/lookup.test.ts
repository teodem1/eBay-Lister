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
  it("opens an empty listing when nothing is known", () => {
    expect(listingHref(base)).toBe("/listing");
  });
});
