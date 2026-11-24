import { describe, expect, it } from "vitest";
import { discogsEvidence, discogsPriceFor, discogsReference } from "./discogs";

function fakeDiscogs(routes: Record<string, unknown | number>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Discogs token=T");
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined || typeof body === "number") return new Response("{}", { status: typeof body === "number" ? body : 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("discogsReference", () => {
  it("finds the CD pressing by barcode and reads its price guide", async () => {
    const { calls, fetchImpl } = fakeDiscogs({
      "/database/search": {
        results: [
          { id: 1, title: "Genesis - Wind & Wuthering", format: ["Vinyl", "LP"] },
          { id: 2, title: "Genesis - Wind & Wuthering", format: ["CD", "Album"], country: "Canada", year: "1985", uri: "/release/2-Genesis", community: { have: 900, want: 120 } },
        ],
      },
      "/marketplace/price_suggestions/2": { "Near Mint (NM or M-)": { value: 31.456, currency: "CAD" }, "Very Good (VG)": { value: 14, currency: "CAD" } },
      "/marketplace/stats/2": { lowest_price: { value: 22, currency: "CAD" }, num_for_sale: 7 },
    });
    const ref = await discogsReference("075992731324", { token: "T", fetchImpl });
    expect(ref).toMatchObject({
      releaseId: 2,
      country: "Canada",
      url: "https://www.discogs.com/release/2-Genesis",
      want: 120,
      suggestions: { "Near Mint (NM or M-)": 31.46, "Very Good (VG)": 14 },
      suggestionCurrency: "CAD",
      lowest: { value: 22, currency: "CAD" },
      numForSale: 7,
    });
    expect(calls[0]).toContain("barcode=075992731324");
    expect(discogsPriceFor(ref!, "Near mint")).toBe(31.46);
    expect(discogsEvidence(ref!, "Near mint")).toContain("Suggested price for the seller's grade (Near Mint (NM or M-)): 31.46 CAD");
  });

  it("still answers when price suggestions are refused (no seller settings)", async () => {
    const { fetchImpl } = fakeDiscogs({
      "/database/search": { results: [{ id: 5, title: "X", format: ["CD"] }] },
      "/marketplace/price_suggestions/5": 403,
      "/marketplace/stats/5": { lowest_price: null, num_for_sale: 0 },
    });
    const ref = await discogsReference("123456789012", { token: "T", fetchImpl });
    expect(ref).toMatchObject({ releaseId: 5, suggestions: {}, numForSale: 0 });
    expect(ref?.lowest).toBeUndefined();
  });

  it("returns null for an unknown barcode", async () => {
    const { fetchImpl } = fakeDiscogs({ "/database/search": { results: [] } });
    expect(await discogsReference("123456789012", { token: "T", fetchImpl })).toBeNull();
  });
});
