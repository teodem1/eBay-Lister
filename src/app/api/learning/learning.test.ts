import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "../../../lib/comps/store";
import type { SaleOutcome } from "../../../lib/learning/outcomes";

let files: Record<string, string> = {};
const backend: Backend = { read: async (p) => files[p] ?? null, write: async (p, b) => void (files[p] = b) };
const findCurrentListings = vi.fn();

vi.mock("@/lib/comps/store", async (orig) => ({ ...(await orig<object>()), blobBackend: () => backend }));
vi.mock("@/lib/ebay", () => ({ getEbayClient: () => ({ config: { marketplaceId: "EBAY_CA" } }) }));
vi.mock("@/lib/ebay/comparables", () => ({ findCurrentListings: (...a: unknown[]) => findCurrentListings(...a) }));

const { POST: postOutcome } = await import("./outcome/route");
const { GET: getLearning } = await import("./route");

const sold = (id: string, value: number, daysAgo: number) => ({
  itemId: id,
  title: "Genesis Wind & Wuthering CD",
  price: { value, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: null, postalCode: null },
  shippingDestination: null,
  condition: "Very Good",
  soldDate: new Date(Date.UTC(2026, 10, 28) - daysAgo * 86_400_000).toISOString().slice(0, 10),
  quantitySold: 1,
  url: null,
});
const listing = (id: string) => ({ ...sold(id, 15, 0), soldDate: null });

const body = { barcode: "075678154323", artist: "Genesis", title: "Wind & Wuthering", soldPrice: 15, soldAt: "2026-11-27" };
const post = (b: unknown, headers: Record<string, string> = {}) =>
  postOutcome(new Request("http://x/api/learning/outcome", { method: "POST", body: JSON.stringify(b), headers }));
const outcomes = () => JSON.parse(files["learning/outcomes.json"]) as SaleOutcome[];

beforeEach(() => {
  files = {
    "comps/upc/075678154323.json": JSON.stringify({
      version: 1,
      savedAt: "2026-11-28T00:00:00.000Z",
      partial: false,
      barcode: "075678154323",
      queries: [{ by: "barcode", items: [sold("a", 10, 10), sold("b", 12, 40), sold("c", 14, 70), sold("d", 16, 100), sold("e", 18, 130)] }],
      filtered: { cdOnly: ["a", "b", "c", "d", "e"], sameGrade: ["a", "b", "c", "d", "e"], detail: {} },
    }),
  };
  findCurrentListings.mockReset().mockResolvedValue({ items: [listing("x"), listing("y")], matchedBy: "barcode" });
});

describe("POST /api/learning/outcome", () => {
  it("records where the sale price sits among the stored sales, with the listings now and the engagement", async () => {
    const res = await post(body);
    expect(res.status).toBe(200);
    const [o] = outcomes();
    expect(o).toMatchObject({ key: "comps/upc/075678154323.json", soldPrice: 15, percentile: 60, salesCount: 5, median: 14, listedNow: 2, level: "high" });
  });

  it("replaces the record when the same sale is edited, and keeps other sales", async () => {
    await post(body);
    await post({ ...body, soldPrice: 18 });
    await post({ ...body, soldAt: "2026-11-20" });
    expect(outcomes().map((o) => [o.soldAt, o.soldPrice])).toEqual([
      ["2026-11-27", 18],
      ["2026-11-20", 15],
    ]);
  });

  it("still records the sale when eBay listings cannot be read", async () => {
    findCurrentListings.mockRejectedValue(new Error("eBay down"));
    await post(body);
    expect(outcomes()[0]).toMatchObject({ listedNow: null, level: null, percentile: 60 });
  });

  it("refuses the key header (phone only) and a sale without a price", async () => {
    expect((await post(body, { "x-elister-key": "k" })).status).toBe(401);
    expect((await post({ ...body, soldPrice: 0 })).status).toBe(400);
    expect(files["learning/outcomes.json"]).toBeUndefined();
  });
});

describe("GET /api/learning", () => {
  it("gives the learned position of an engagement level once it has 5 sales, else nothing", async () => {
    for (const day of ["01", "02", "03", "04"]) await post({ ...body, soldAt: `2026-11-${day}` });
    const four = await (await getLearning(new Request("http://x/api/learning?level=high"))).json();
    expect(four.position).toBeNull();
    await post({ ...body, soldAt: "2026-11-05" });
    const five = await (await getLearning(new Request("http://x/api/learning?level=high"))).json();
    expect(five.position).toEqual({ percentile: 60, n: 5 });
    expect((await (await getLearning(new Request("http://x/api/learning?level=low"))).json()).position).toBeNull();
  });
});
