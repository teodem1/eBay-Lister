import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BothOptions } from "../../../lib/ebay/comparables";
import type { Comparable, ComparableResult } from "../../../lib/ebay/types";

const findBothComparables = vi.fn();
const saveLookup = vi.fn();
const blobBackend = vi.fn();

vi.mock("@/lib/ebay", () => ({ getEbayClient: () => ({ config: { marketplaceId: "EBAY_CA" } }) }));
vi.mock("@/lib/ebay/comparables", () => ({
  findBothComparables: (...a: unknown[]) => findBothComparables(...a),
}));
vi.mock("@/lib/comps/store", () => ({
  blobBackend: () => blobBackend(),
  saveLookup: (...a: unknown[]) => saveLookup(...a),
}));

const { POST } = await import("./route");

const sale = (itemId: string, value: number): Comparable => ({
  itemId,
  title: "Genesis Wind & Wuthering CD",
  price: { value, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: "CA", postalCode: null },
  shippingDestination: "CA",
  condition: "Very Good",
  soldDate: "2026-11-01",
  quantitySold: 1,
  url: null,
});

const soldResult = (items: Comparable[]): ComparableResult => ({
  source: "sold_comps",
  marketplaceId: "EBAY_CA",
  items,
  notes: [],
});

const body = { gtin: "0075678154323", keywords: "Genesis Wind & Wuthering", sellerCondition: "USED_VERY_GOOD" };
const post = (b: unknown = body) =>
  POST(new Request("http://x/api/price-suggestion", { method: "POST", body: JSON.stringify(b) }));

/** Fakes the comparables search: reports each sold query, then returns the last one as the sold result. */
function searchReturns(queries: [by: "barcode" | "keywords", items: Comparable[]][], soldFails = false) {
  findBothComparables.mockImplementation(async (_c: unknown, _q: unknown, opts: BothOptions) => {
    for (const [by, items] of queries) opts.onSoldQuery?.(by, items);
    return {
      current: null,
      sold: soldFails ? null : soldResult(queries.at(-1)?.[1] ?? []),
      unavailable: soldFails ? { sold: "Sold search failed: boom" } : {},
    };
  });
}

beforeEach(() => {
  findBothComparables.mockReset();
  saveLookup.mockReset().mockResolvedValue("saved");
  blobBackend.mockReset().mockReturnValue({ read: vi.fn(), write: vi.fn() });
});

describe("POST /api/price-suggestion saving sold lookups", () => {
  it("saves once with both queries and the request's barcode, name and grade", async () => {
    searchReturns([
      ["barcode", [sale("1", 10)]],
      ["keywords", [sale("1", 10), sale("2", 12), sale("3", 14)]],
    ]);
    const res = await post();
    expect(res.status).toBe(200);
    expect(saveLookup).toHaveBeenCalledTimes(1);
    const [, input] = saveLookup.mock.calls[0];
    expect(input).toMatchObject({
      partial: false,
      barcode: "0075678154323",
      name: "Genesis Wind & Wuthering",
      condition: "USED_VERY_GOOD",
    });
    expect(input.queries.map((q: { by: string; items: Comparable[] }) => [q.by, q.items.length])).toEqual([
      ["barcode", 1],
      ["keywords", 3],
    ]);
    expect(Number.isNaN(Date.parse(input.savedAt))).toBe(false);
  });

  it("saves under the short search name, as the plugin reads it", async () => {
    searchReturns([["keywords", [sale("1", 10)]]]);
    await post({ keywords: "James Horner Braveheart (Original Motion Picture Soundtrack)" });
    expect(saveLookup.mock.calls[0][1].name).toBe("James Horner Braveheart");
  });

  it("answers the same 200 body when the save fails", async () => {
    searchReturns([["keywords", [sale("1", 10), sale("2", 12), sale("3", 14)]]]);
    const ok = await (await post()).json();
    saveLookup.mockRejectedValue(new Error("blob down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ok);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("saves nothing when the sold search failed", async () => {
    searchReturns([["barcode", [sale("1", 10)]]], true);
    await post();
    expect(saveLookup).not.toHaveBeenCalled();
  });

  it("saves an empty sold result so it is not bought again", async () => {
    searchReturns([["keywords", []]]);
    await post();
    expect(saveLookup).toHaveBeenCalledTimes(1);
    expect(saveLookup.mock.calls[0][1].queries).toEqual([{ by: "keywords", items: [] }]);
  });

  it("saves nothing without a Blob store", async () => {
    blobBackend.mockReturnValue(null);
    searchReturns([["keywords", [sale("1", 10)]]]);
    expect((await post()).status).toBe(200);
    expect(saveLookup).not.toHaveBeenCalled();
  });
});
