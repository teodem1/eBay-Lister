import { describe, expect, it } from "vitest";
import type { Comparable } from "../ebay/types";
import type { StoredLookup } from "./record";
import { blobBackend, readLookup, saveLookup, type Backend } from "./store";

const sale = (itemId: string, title: string, value: number): Comparable => ({
  itemId,
  title,
  price: { value, currency: "CAD" },
  shippingCost: null,
  itemLocation: { country: null, postalCode: null },
  shippingDestination: null,
  condition: null,
  soldDate: null,
  quantitySold: 1,
  url: null,
});

function memory(files: Record<string, string> = {}) {
  const writes: { path: string; body: string }[] = [];
  const reads: string[] = [];
  const backend: Backend = {
    async read(path) {
      reads.push(path);
      return files[path] ?? null;
    },
    async write(path, body) {
      writes.push({ path, body });
      files[path] = body;
    },
  };
  return { backend, files, writes, reads };
}

const UPC = "comps/upc/075678154323.json";
const NAME = "comps/name/genesis-wind-wuthering.json";

const input = (partial: boolean): Omit<StoredLookup, "version" | "filtered"> => ({
  savedAt: "2026-11-28T00:00:00.000Z",
  partial,
  barcode: "0075678154323",
  name: "Genesis Wind & Wuthering",
  queries: [{ by: "barcode", items: [sale("a", "Genesis Wind & Wuthering CD Canada", 20)] }],
});

const stored = (partial: boolean): StoredLookup => ({
  version: 1,
  ...input(partial),
  filtered: { cdOnly: [], sameGrade: [], detail: {} as StoredLookup["filtered"]["detail"] },
});

describe("readLookup", () => {
  it("finds the lookup under the second key when the first is absent", async () => {
    const { backend } = memory({ [NAME]: JSON.stringify(stored(false)) });
    expect((await readLookup(backend, [UPC, NAME]))?.name).toBe("Genesis Wind & Wuthering");
  });

  it("is null when no key holds a lookup", async () => {
    const { backend } = memory();
    expect(await readLookup(backend, [UPC, NAME])).toBeNull();
  });

  it("rejects when storage cannot be read, never reading it as not stored", async () => {
    const backend: Backend = {
      read: () => Promise.reject(new Error("blob down")),
      write: async () => {},
    };
    await expect(readLookup(backend, [UPC])).rejects.toThrow("blob down");
  });

  it("rejects unreadable JSON", async () => {
    const { backend } = memory({ [UPC]: "{not json" });
    await expect(readLookup(backend, [UPC, NAME])).rejects.toThrow();
  });

  it("rejects a file that is not a stored lookup", async () => {
    const { backend } = memory({ [UPC]: JSON.stringify({ hello: 1 }) });
    await expect(readLookup(backend, [UPC])).rejects.toThrow();
  });
});

describe("saveLookup", () => {
  it("writes once, to the first key, with the filtered sets", async () => {
    const { backend, writes } = memory();
    expect(await saveLookup(backend, input(false))).toBe("saved");
    expect(writes.map((w) => w.path)).toEqual([UPC]);
    const body = JSON.parse(writes[0].body) as StoredLookup;
    expect(body.version).toBe(1);
    expect(body.filtered.cdOnly).toEqual(["a"]);
    expect(body.filtered.detail.canadian).toEqual(["a"]);
  });

  it("does not read before a full save", async () => {
    const { backend, reads } = memory();
    await saveLookup(backend, input(false));
    expect(reads).toEqual([]);
  });

  it("keeps a full result when a partial one arrives, writing nothing", async () => {
    const { backend, writes } = memory({ [UPC]: JSON.stringify(stored(false)) });
    expect(await saveLookup(backend, input(true))).toBe("kept");
    expect(writes).toEqual([]);
  });

  it("replaces a partial result with a full one", async () => {
    const { backend, writes } = memory({ [UPC]: JSON.stringify(stored(true)) });
    expect(await saveLookup(backend, input(false))).toBe("saved");
    expect(writes).toHaveLength(1);
  });

  it("saves a partial result when nothing is stored", async () => {
    const { backend, writes } = memory();
    expect(await saveLookup(backend, input(true))).toBe("saved");
    expect(writes).toHaveLength(1);
  });

  it("returns no_key for a lookup with no usable barcode or name", async () => {
    const { backend, writes, reads } = memory();
    expect(await saveLookup(backend, { ...input(false), barcode: "123", name: "???" })).toBe("no_key");
    expect(await saveLookup(backend, { ...input(true), barcode: undefined, name: " " })).toBe("no_key");
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("rejects a partial save when storage cannot be read, writing nothing", async () => {
    const writes: string[] = [];
    const backend: Backend = {
      read: () => Promise.reject(new Error("blob down")),
      write: async (p) => void writes.push(p),
    };
    await expect(saveLookup(backend, input(true))).rejects.toThrow("blob down");
    expect(writes).toEqual([]);
  });
});

describe("blobBackend", () => {
  it("is null without a Blob token or store id", () => {
    expect(blobBackend({})).toBeNull();
  });

  it("exists with a read-write token or a store id", () => {
    expect(blobBackend({ BLOB_READ_WRITE_TOKEN: "x" })).not.toBeNull();
    expect(blobBackend({ BLOB_STORE_ID: "store_x" })).not.toBeNull();
  });
});
