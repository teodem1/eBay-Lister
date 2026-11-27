/**
 * Rewrites the seller's live listings with the current listing rules
 * (title, item specifics, description), without touching anything else.
 *
 * 1. listLiveListings: the inventory items that have a published offer.
 * 2. previewRefresh: Claude rewrites one listing from what eBay has (album, barcode,
 *    the seller's grades in the condition text); nothing is sent to eBay.
 * 3. applyRefresh: puts the previewed title, item specifics and description on the
 *    live listing. Price, Best Offer, policies (shipping), promotion, photos,
 *    condition, category and quantity are read back from eBay and sent unchanged.
 */
import { GRADES, type Grade } from "../listing/condition";
import type { SellerCondition } from "../listing/conditionSchema";
import { generateListing, type GenerateDeps } from "../listing/generate";
import { TITLE_MAX } from "../listing/limits";
import { CONDITIONS, type Condition, type EbaySellClient } from "./sell";

export interface LiveListing {
  sku: string;
  listingId?: string;
  title: string;
  price?: number;
  imageUrl?: string;
}

export interface ListingContent {
  title: string;
  /** eBay's shape: name -> values. */
  aspects: Record<string, string[]>;
  descriptionHtml: string;
}

export interface RefreshPreview {
  sku: string;
  listingId?: string;
  imageUrl?: string;
  before: ListingContent;
  after: ListingContent;
  /** Item specifics Claude added or changed, by name. */
  changedAspects: string[];
  /** Open questions from Claude (values it could not confirm). */
  checks: string[];
}

export type ApplyResult =
  | { status: "updated"; sku: string; listingId?: string }
  | { status: "skipped"; sku: string; reason: string };

type Raw = Record<string, unknown>;

const product = (item: Raw) => (item.product as Raw | undefined) ?? {};
const published = (offers: Raw[]) => offers.find((o) => o.status === "PUBLISHED");
const listingIdOf = (offer: Raw) => (offer.listing as { listingId?: string } | undefined)?.listingId;

/** One page of live listings (inventory items with a published offer). */
export async function listLiveListings(
  client: EbaySellClient,
  offset = 0,
  limit = 50,
): Promise<{ listings: LiveListing[]; total: number; nextOffset?: number }> {
  const { items, total } = await client.listInventoryItems(offset, limit);
  const listings: LiveListing[] = [];
  // A few at a time: one offer lookup per item.
  for (let i = 0; i < items.length; i += 5) {
    const batch = items.slice(i, i + 5);
    const found = await Promise.all(
      batch.map(async (item) => {
        const sku = String(item.sku ?? "");
        if (!sku) return null;
        const offer = published(await client.getOffersRaw(sku));
        if (!offer) return null;
        const p = product(item);
        const price = Number((offer.pricingSummary as { price?: { value?: string } } | undefined)?.price?.value);
        return {
          sku,
          listingId: listingIdOf(offer),
          title: String(p.title ?? ""),
          price: Number.isFinite(price) ? price : undefined,
          imageUrl: (p.imageUrls as string[] | undefined)?.[0],
        } satisfies LiveListing;
      }),
    );
    for (const l of found) if (l) listings.push(l);
  }
  const next = offset + items.length;
  return { listings, total, nextOffset: items.length === limit && next < total ? next : undefined };
}

const PART_LABELS: Record<string, "disc" | "booklet" | "case"> = {
  disc: "disc",
  "inlay / booklet": "booklet",
  inlay: "booklet",
  booklet: "booklet",
  case: "case",
};

/** Reads a grade as the app writes it ("near mint", "Near Mint", "very good+"). */
function readGrade(text: string): Grade | "Missing" | undefined {
  const t = text.trim().toLowerCase();
  if (t === "missing") return "Missing";
  return GRADES.find((g) => g.toLowerCase() === t);
}

/**
 * The seller's grades back from a live listing: the condition text the app wrote
 * ("Disc: near mint. Inlay / booklet: near mint. Case: good. Tested: ... Small crack."),
 * else the title's "(Disc: Near Mint / Inlay: Near Mint)". Undefined when neither has them.
 */
export function sellerConditionFromListing(item: Raw): SellerCondition | undefined {
  const ebayCondition = CONDITIONS.includes(item.condition as Condition) ? (item.condition as Condition) : undefined;
  const text = String(item.conditionDescription ?? "").trim();
  const title = String(product(item).title ?? "");
  const sc: Partial<SellerCondition> = {};
  const notes: string[] = [];

  if (/\bnew, factory sealed\b/i.test(text) || /\(Sealed\)\s*$/i.test(title)) sc.condition = "NEW";
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const s = sentence.trim();
    if (!s || /^new, factory sealed\.?$/i.test(s)) continue;
    if (/^tested: plays through without skips\.?$/i.test(s)) {
      sc.tested = true;
      continue;
    }
    const m = /^([a-z /]+):\s*(.+?)\.?$/i.exec(s);
    const part = m ? PART_LABELS[m[1].trim().toLowerCase()] : undefined;
    const grade = m ? readGrade(m[2]) : undefined;
    if (part && grade && !(part === "disc" && grade === "Missing")) {
      if (part === "disc") sc.disc = grade as Grade;
      else sc[part] = grade;
      continue;
    }
    notes.push(s);
  }
  // Older listings: grades only in the title.
  const t = /\(Disc:\s*([^/)]+?)\s*(?:\/\s*Inlay:\s*([^)]+?)\s*)?\)\s*$/i.exec(title);
  if (t) {
    const disc = readGrade(t[1]);
    if (!sc.disc && disc && disc !== "Missing") sc.disc = disc;
    const inlay = t[2] ? readGrade(t[2]) : undefined;
    if (!sc.booklet && inlay) sc.booklet = inlay;
  }
  if (notes.length) sc.notes = notes.join(" ").slice(0, 600);
  if (sc.condition !== "NEW") {
    if (!sc.disc) return undefined;
    sc.condition = ebayCondition && ebayCondition !== "NEW" ? ebayCondition : "USED_VERY_GOOD";
  }
  return sc as SellerCondition;
}

/** "Artist Album" for Claude: from the item specifics, else the title without " CD (...)". */
export function queryFromListing(item: Raw): string {
  const p = product(item);
  const aspects = (p.aspects as Record<string, string[]> | undefined) ?? {};
  const get = (...names: string[]) =>
    Object.entries(aspects).find(([k]) => names.includes(k.trim().toLowerCase()))?.[1]?.[0]?.trim();
  const artist = get("artist", "artiste");
  const album = get("release title", "album", "album name");
  if (artist && album) return `${artist} ${album}`;
  return String(p.title ?? "")
    .replace(/\s*\((?:Disc:[^)]*|Sealed)\)\s*$/i, "")
    .replace(/\s+\bCD\b\s*$/i, "")
    .trim();
}

function barcodeOf(item: Raw): string | undefined {
  const p = product(item);
  const first = (k: string) => (p[k] as string[] | undefined)?.[0];
  return first("upc") ?? first("ean") ?? first("isbn") ?? (/^BC-(\d{8,14})-/i.exec(String(item.sku ?? ""))?.[1] || undefined);
}

/**
 * Keeps every item specific the listing has, and lays Claude's certain values on top.
 * Nothing is dropped, so a value eBay already matched on is never lost.
 */
export function mergeAspects(
  before: Record<string, string[]>,
  fresh: { name: string; value: string; guessed?: boolean }[],
): { aspects: Record<string, string[]>; changed: string[] } {
  const aspects: Record<string, string[]> = { ...before };
  const changed: string[] = [];
  for (const a of fresh) {
    const name = a.name.trim();
    const values = a.value.split("|").map((v) => v.trim()).filter(Boolean);
    // A live listing gets no guessed value (it goes to the open questions instead), and Brand/MPN stay as listed.
    if (!name || values.length === 0 || a.guessed || /^(brand|mpn)$/i.test(name)) continue;
    const key = Object.keys(aspects).find((k) => k.trim().toLowerCase() === name.toLowerCase()) ?? name;
    const old = aspects[key];
    if (old && old.join("|").toLowerCase() === values.join("|").toLowerCase()) continue;
    aspects[key] = values.map((v) => v.slice(0, 65)); // eBay's limit per value
    changed.push(key);
  }
  return { aspects, changed };
}

/** Claude rewrites one live listing with the current rules. Reads eBay, writes nothing. */
export async function previewRefresh(
  client: EbaySellClient,
  sku: string,
  deps: Omit<GenerateDeps, "ebay">,
): Promise<RefreshPreview> {
  const item = await client.getInventoryItemRaw(sku);
  if (!item) throw new Error("eBay has no inventory item for this SKU.");
  const offer = published(await client.getOffersRaw(sku));
  if (!offer) throw new Error("This listing is not live (it sold or ended).");
  const sellerCondition = sellerConditionFromListing(item);
  if (!sellerCondition) throw new Error("The listing has no disc grade in its title or condition text, so it was left alone.");

  const p = product(item);
  const before: ListingContent = {
    title: String(p.title ?? ""),
    aspects: (p.aspects as Record<string, string[]> | undefined) ?? {},
    descriptionHtml: String(offer.listingDescription ?? p.description ?? ""),
  };
  const generated = await generateListing(
    {
      query: queryFromListing(item),
      barcode: barcodeOf(item),
      sellerCondition,
      categoryId: typeof offer.categoryId === "string" ? offer.categoryId : undefined,
    },
    { ...deps, ebay: client },
  );
  const { aspects, changed } = mergeAspects(before.aspects, generated.draft.aspects);
  return {
    sku,
    listingId: listingIdOf(offer),
    imageUrl: (p.imageUrls as string[] | undefined)?.[0],
    before,
    after: { title: generated.draft.title, aspects, descriptionHtml: generated.draft.descriptionHtml },
    changedAspects: changed,
    checks: generated.checks,
  };
}

/**
 * Puts a previewed title, item specifics and description on the live listing.
 * Skips it when the listing is no longer live or its title changed since the preview.
 */
export async function applyRefresh(
  client: EbaySellClient,
  sku: string,
  expectedTitle: string,
  after: ListingContent,
): Promise<ApplyResult> {
  if (!after.title.trim() || after.title.length > TITLE_MAX) return { status: "skipped", sku, reason: "The new title is empty or too long." };
  if (!after.descriptionHtml.trim()) return { status: "skipped", sku, reason: "The new description is empty." };
  const item = await client.getInventoryItemRaw(sku);
  if (!item) return { status: "skipped", sku, reason: "eBay has no inventory item for this SKU any more." };
  const offer = published(await client.getOffersRaw(sku));
  if (!offer) return { status: "skipped", sku, reason: "The listing is no longer live (it sold or ended)." };
  if (String(product(item).title ?? "") !== expectedTitle) {
    return { status: "skipped", sku, reason: "The listing changed since the preview. Preview it again." };
  }
  await client.putInventoryItemRaw(sku, {
    ...item,
    product: { ...product(item), title: after.title, description: after.descriptionHtml, aspects: after.aspects },
  });
  await client.putOfferRaw({ ...offer, listingDescription: after.descriptionHtml });
  return { status: "updated", sku, listingId: listingIdOf(offer) };
}
