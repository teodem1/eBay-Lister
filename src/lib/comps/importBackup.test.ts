import { describe, expect, it } from "vitest";
import { importBackup, ImportBody, type ImportItem } from "./importBackup";
import type { StoredLookup } from "./record";
import type { Backend } from "./store";

function memory(files: Record<string, string> = {}) {
  const writes: string[] = [];
  const backend: Backend = {
    async read(path) {
      return files[path] ?? null;
    },
    async write(path, body) {
      writes.push(path);
      files[path] = body;
    },
  };
  return { backend, files, writes };
}

const sale = (itemId: string, value: number) => ({
  itemId,
  title: "Genesis Wind & Wuthering CD",
  price: { value, currency: "CAD" },
});

const item = (over: Record<string, unknown> = {}): ImportItem =>
  ImportBody.parse({
    items: [
      {
        barcode: "0075678154323",
        priceCheckedAt: "2026-10-01T12:00:00.000Z",
        priceCheck: { keywords: "Genesis Wind & Wuthering", condition: "USED_VERY_GOOD", soldItems: [sale("a", 12)] },
        ...over,
      },
    ],
  }).items[0];

const UPC = "comps/upc/075678154323.json";

describe("importBackup", () => {
  it("saves a backup check as a partial lookup dated when it was checked", async () => {
    const { backend, files } = memory();
    expect(await importBackup(backend, [item()])).toEqual({ saved: 1, kept: 0, skipped: 0 });
    const stored = JSON.parse(files[UPC]) as StoredLookup;
    expect(stored.partial).toBe(true);
    expect(stored.savedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(stored.name).toBe("Genesis Wind & Wuthering");
    expect(stored.condition).toBe("USED_VERY_GOOD");
    expect(stored.queries).toHaveLength(1);
    expect(stored.queries[0].by).toBe("keywords");
    expect(stored.queries[0].items[0]).toMatchObject({ itemId: "a", price: { value: 12, currency: "CAD" }, quantitySold: 1 });
  });

  it("skips a check with no sold items", async () => {
    const { backend, writes } = memory();
    const empty = item({ priceCheck: { keywords: "Genesis Wind & Wuthering", soldItems: [] } });
    const missing = item({ priceCheck: { keywords: "Genesis Wind & Wuthering" } });
    expect(await importBackup(backend, [empty, missing])).toEqual({ saved: 0, kept: 0, skipped: 2 });
    expect(writes).toEqual([]);
  });

  it("skips a check with no usable barcode or name", async () => {
    const { backend } = memory();
    const noKey = item({ barcode: undefined, priceCheck: { keywords: "???", soldItems: [sale("a", 1)] } });
    expect(await importBackup(backend, [noKey])).toEqual({ saved: 0, kept: 0, skipped: 1 });
  });

  it("keeps a full lookup already stored", async () => {
    const full: StoredLookup = {
      version: 1,
      savedAt: "2026-11-20T00:00:00.000Z",
      partial: false,
      queries: [],
      filtered: { cdOnly: [], sameGrade: [], detail: {} as StoredLookup["filtered"]["detail"] },
    };
    const { backend, writes } = memory({ [UPC]: JSON.stringify(full) });
    expect(await importBackup(backend, [item()])).toEqual({ saved: 0, kept: 1, skipped: 0 });
    expect(writes).toEqual([]);
  });

  it("stops when storage cannot be read", async () => {
    const backend: Backend = { read: () => Promise.reject(new Error("blob down")), write: async () => {} };
    await expect(importBackup(backend, [item()])).rejects.toThrow("blob down");
  });
});

describe("ImportBody", () => {
  it("rejects a sale without an id, title or price", () => {
    const bad = (s: unknown) =>
      ImportBody.safeParse({
        items: [{ priceCheckedAt: "2026-10-01", priceCheck: { keywords: "x", soldItems: [s] } }],
      }).success;
    expect(bad({ title: "t", price: { value: 1, currency: "CAD" } })).toBe(false);
    expect(bad({ itemId: "a", price: { value: 1, currency: "CAD" } })).toBe(false);
    expect(bad({ itemId: "a", title: "t", price: { value: 1 } })).toBe(false);
    expect(bad({ itemId: "a", title: "t", price: { value: 1, currency: "CAD" } })).toBe(true);
  });

  it("accepts at most 300 items", () => {
    const one = { priceCheckedAt: "2026-10-01", priceCheck: { keywords: "x" } };
    expect(ImportBody.safeParse({ items: Array(300).fill(one) }).success).toBe(true);
    expect(ImportBody.safeParse({ items: Array(301).fill(one) }).success).toBe(false);
  });
});
