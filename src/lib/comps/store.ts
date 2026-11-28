/**
 * Stored sold lookups in private Vercel Blob: one JSON file per lookup, read by
 * key, written once per lookup, never listed. Storage that cannot be read makes
 * these reject; a caller must stop rather than treat it as "not stored" and
 * spend a paid lookup.
 */
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { filterLookup, lookupKeys, type StoredLookup } from "./record";

export interface Backend {
  /** The file's text, or null when there is no such file. Rejects when storage cannot be read. */
  read(path: string): Promise<string | null>;
  /** With `ifMatch`, writes only if the file is still that version, else rejects with `WriteConflict`. */
  write(path: string, body: string, opts?: { ifMatch?: string }): Promise<void>;
  /** The file's text and version (for a conditional write), or null when there is no such file. */
  readTagged?(path: string): Promise<{ text: string; etag: string } | null>;
}

/** A conditional write found the file changed since it was read: read it again and redo the change. */
export class WriteConflict extends Error {
  constructor(path: string) {
    super(`${path} changed while it was being written.`);
    this.name = "WriteConflict";
  }
}

/** The Blob store, or null when the app has no Blob store connected. */
export function blobBackend(env: Record<string, string | undefined> = process.env): Backend | null {
  const token = env.BLOB_READ_WRITE_TOKEN || undefined;
  const storeId = env.BLOB_STORE_ID || undefined;
  if (!token && !storeId) return null;
  const auth = token ? { token } : { storeId };
  const readTagged = async (path: string) => {
    const res = await get(path, { access: "private", useCache: false, ...auth });
    if (!res) return null;
    if (res.statusCode !== 200) throw new Error(`Stored file ${path} came back without a body.`);
    return { text: await new Response(res.stream).text(), etag: res.blob.etag };
  };
  return {
    readTagged,
    async read(path) {
      return (await readTagged(path))?.text ?? null;
    },
    async write(path, body, opts) {
      try {
        await put(path, body, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
          ...(opts?.ifMatch && { ifMatch: opts.ifMatch }),
          ...auth,
        });
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) throw new WriteConflict(path);
        throw err;
      }
    },
  };
}

function parseLookup(path: string, text: string): StoredLookup {
  const v = JSON.parse(text) as Partial<StoredLookup> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.queries) || !v.filtered || typeof v.savedAt !== "string") {
    throw new Error(`Stored lookup ${path} is not readable.`);
  }
  return v as StoredLookup;
}

/** The first stored lookup found under these keys, in order; null when none is stored. */
export async function readLookup(b: Backend, keys: string[]): Promise<StoredLookup | null> {
  for (const key of keys) {
    const text = await b.read(key);
    if (text !== null) return parseLookup(key, text);
  }
  return null;
}

/**
 * Saves a lookup under its first key, with the filtered sets. A partial result
 * (imported from a backup) never replaces a full one stored under any of its keys;
 * only a partial save reads first.
 */
export async function saveLookup(
  b: Backend,
  input: Omit<StoredLookup, "version" | "filtered">,
): Promise<"saved" | "kept" | "no_key"> {
  const keys = lookupKeys({ barcode: input.barcode, name: input.name });
  if (!keys.length) return "no_key";
  if (input.partial) {
    const existing = await readLookup(b, keys);
    if (existing && !existing.partial) return "kept";
  }
  const record: StoredLookup = {
    version: 1,
    ...input,
    filtered: filterLookup(input.queries, input.name, input.condition),
  };
  await b.write(keys[0], JSON.stringify(record));
  return "saved";
}
