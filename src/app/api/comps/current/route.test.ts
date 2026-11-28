import { beforeEach, describe, expect, it, vi } from "vitest";

const findCurrentListings = vi.fn();
vi.mock("@/lib/ebay", () => ({ getEbayClient: () => ({ config: { marketplaceId: "EBAY_CA" } }) }));
vi.mock("@/lib/ebay/comparables", () => ({
  findCurrentListings: (...a: unknown[]) => findCurrentListings(...a),
}));

const { GET } = await import("./route");
const get = (qs: string) => GET(new Request(`http://x/api/comps/current?${qs}`));

const listing = (itemId: string, title: string) => ({
  itemId,
  title,
  price: { value: 10, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: "CA", postalCode: null },
  shippingDestination: "CA",
  condition: "Used",
  soldDate: null,
  quantitySold: 1,
  url: null,
});

beforeEach(() => {
  findCurrentListings.mockReset();
});

describe("GET /api/comps/current", () => {
  it("counts the CDs listed now, by barcode, leaving other formats out", async () => {
    findCurrentListings.mockResolvedValue({
      items: [listing("a", "Braveheart CD"), listing("b", "Braveheart CD 1995"), listing("c", "Braveheart Vinyl LP")],
      matchedBy: "barcode",
    });
    const res = await get("barcode=0777499240506&name=James%20Horner%20Braveheart");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2, capped: false, matchedBy: "barcode" });
    const [, query] = findCurrentListings.mock.calls[0];
    expect(query).toMatchObject({ gtin: "0777499240506", keywords: "James Horner Braveheart", limit: 200, destinationCountry: "CA" });
  });

  it("says when the count reached the search limit", async () => {
    findCurrentListings.mockResolvedValue({ items: Array.from({ length: 200 }, (_, i) => listing(String(i), "Coldplay CD")), matchedBy: "keywords" });
    expect((await (await get("name=Coldplay%20Parachutes")).json()).capped).toBe(true);
  });

  it("searches by name only when the barcode is not usable", async () => {
    findCurrentListings.mockResolvedValue({ items: [], matchedBy: "keywords" });
    await get("barcode=123&name=Coldplay%20Parachutes");
    expect(findCurrentListings.mock.calls[0][1].gtin).toBeUndefined();
  });

  it("answers 400 without a barcode or a name", async () => {
    expect((await get("")).status).toBe(400);
    expect(findCurrentListings).not.toHaveBeenCalled();
  });

  it("answers 502 when eBay fails", async () => {
    findCurrentListings.mockRejectedValue(new Error("eBay down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("name=Coldplay%20Parachutes")).status).toBe(502);
    errSpy.mockRestore();
  });
});
