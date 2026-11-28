import { beforeEach, describe, expect, it, vi } from "vitest";

const readListing = vi.fn();
vi.mock("@/lib/ebay/refreshListings", () => ({ readListing: (...a: unknown[]) => readListing(...a) }));
vi.mock("../shared", () => ({
  sellClient: () => ({ client: {}, config: {} }),
  errorResponse: () => Response.json({ error: "eBay failed" }, { status: 502 }),
}));

const { GET } = await import("./route");
const get = (qs: string) => GET(new Request(`http://x/api/listing/refresh/read?${qs}`));

beforeEach(() => {
  readListing.mockReset();
});

describe("GET /api/listing/refresh/read", () => {
  it("answers 400 without a SKU or with one longer than the apply route takes", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get(`sku=${"A".repeat(51)}`)).status).toBe(400);
    expect(readListing).not.toHaveBeenCalled();
  });

  it("answers 404 when the listing is not live", async () => {
    readListing.mockResolvedValue(null);
    expect((await get("sku=BC-1")).status).toBe(404);
  });

  it("returns the listing", async () => {
    readListing.mockResolvedValue({ sku: "BC-1", title: "t" });
    const res = await get("sku=BC-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sku: "BC-1", title: "t" });
    expect(readListing.mock.calls[0][1]).toBe("BC-1");
  });

  it("answers 502 when eBay fails", async () => {
    readListing.mockRejectedValue(new Error("boom"));
    expect((await get("sku=BC-1")).status).toBe(502);
  });
});
