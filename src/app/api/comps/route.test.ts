import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "../../../lib/comps/store";
import type { StoredLookup } from "../../../lib/comps/record";

let backend: Backend | null = null;
vi.mock("@/lib/comps/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/comps/store")>()),
  blobBackend: () => backend,
}));

const { GET } = await import("./route");
const { POST } = await import("./import/route");

const sale = (itemId: string, title: string, condition: string) => ({
  itemId,
  title,
  price: { value: 10, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: null, postalCode: null },
  shippingDestination: null,
  condition,
  soldDate: null,
  quantitySold: 1,
  url: null,
});

const UPC = "comps/upc/075678154323.json";
const stored: StoredLookup = {
  version: 1,
  savedAt: "2026-11-20T00:00:00.000Z",
  partial: false,
  barcode: "0075678154323",
  name: "Genesis Wind & Wuthering",
  queries: [
    {
      by: "barcode",
      items: [
        sale("ln1", "Genesis Wind & Wuthering CD", "Like New"),
        sale("ln2", "Genesis Wind & Wuthering CD", "Like New"),
        sale("ln3", "Genesis Wind & Wuthering CD", "Like New"),
        sale("g1", "Genesis Wind & Wuthering CD", "Good"),
      ],
    },
  ],
  filtered: { cdOnly: [], sameGrade: [], detail: {} as StoredLookup["filtered"]["detail"] },
};

function memory(files: Record<string, string> = {}): Backend {
  return {
    read: async (p) => files[p] ?? null,
    write: async (p, b) => void (files[p] = b),
  };
}

const get = (qs: string) => GET(new Request(`http://x/api/comps?${qs}`));
const post = (body: unknown) =>
  POST(new Request("http://x/api/comps/import", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  backend = memory({ [UPC]: JSON.stringify(stored) });
});

describe("GET /api/comps", () => {
  it("returns the stored lookup with sets filtered for the asked grade", async () => {
    const res = await get("barcode=0075678154323&condition=LIKE_NEW");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.found).toBe(true);
    expect(json.lookup.savedAt).toBe("2026-11-20T00:00:00.000Z");
    expect(json.filtered.sameGrade).toEqual(["ln1", "ln2", "ln3"]);
  });

  it("never answers a barcoded CD with a by-name result", async () => {
    backend = memory({ "comps/name/genesis-wind-wuthering.json": JSON.stringify(stored) });
    const json = await (await get("barcode=0075678154323&name=Genesis%20Wind%20%26%20Wuthering")).json();
    expect(json).toEqual({ found: false });
    const byName = await (await get("name=Genesis%20Wind%20%26%20Wuthering")).json();
    expect(byName.found).toBe(true);
  });

  it("answers found:false when nothing is stored", async () => {
    backend = memory();
    const res = await get("barcode=0075678154323");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
  });

  it("answers 400 without a usable barcode or name", async () => {
    expect((await get("name=%3F%3F%3F")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("answers 400 for an unknown condition", async () => {
    expect((await get("barcode=0075678154323&condition=MINT")).status).toBe(400);
  });

  it("answers 503 when storage is not set up", async () => {
    backend = null;
    expect((await get("barcode=0075678154323")).status).toBe(503);
  });

  it("answers 502 when storage cannot be read, never found:false", async () => {
    backend = { read: () => Promise.reject(new Error("blob down")), write: async () => {} };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("barcode=0075678154323");
    expect(res.status).toBe(502);
    expect((await res.json()).found).toBeUndefined();
    errSpy.mockRestore();
  });
});

describe("POST /api/comps/import", () => {
  const check = {
    barcode: "0602537351169",
    priceCheckedAt: "2026-10-01T12:00:00.000Z",
    priceCheck: { keywords: "Daft Punk Random Access Memories", soldItems: [{ itemId: "a", title: "t", price: { value: 9, currency: "CAD" } }] },
  };

  it("imports and counts saved, kept and skipped", async () => {
    const res = await post({
      items: [check, { ...check, barcode: "0075678154323" }, { ...check, barcode: undefined, priceCheck: { keywords: "x" } }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, kept: 1, skipped: 1 });
  });

  it("answers 400 for an invalid body or more than 300 items", async () => {
    expect((await post({ items: [{ priceCheck: {} }] })).status).toBe(400);
    expect((await post({ items: Array(301).fill(check) })).status).toBe(400);
  });

  it("answers 503 when storage is not set up", async () => {
    backend = null;
    expect((await post({ items: [check] })).status).toBe(503);
  });

  it("answers 502 when storage cannot be read", async () => {
    backend = { read: () => Promise.reject(new Error("blob down")), write: async () => {} };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ items: [check] })).status).toBe(502);
    errSpy.mockRestore();
  });
});
