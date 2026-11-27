/**
 * Pushes a Collection edit (album, artist, year, price) to the CD's live eBay
 * listing. Reads the inventory item and offer as eBay has them, changes only
 * those fields, and puts them back, which revises the live listing. Nothing
 * else in the listing (description, photos, condition, policies) is touched.
 */
import { rescaleBestOfferTerms, type EbaySellClient } from "./sell";

export interface CollectionEdit {
  /** The listing's SKU, when the Collection knows it. */
  sku?: string;
  /** Used to find the listing when there is no SKU (SKUs are "BC-<barcode digits>-…"). */
  barcode?: string;
  /** What the Collection had before the edit, to find them in the eBay title. */
  before: { title: string; artist: string; year?: number; price?: number };
  after: { title: string; artist: string; year?: number; price?: number };
}

export type EditResult =
  | { status: "updated"; sku: string; listingId?: string; changed: string[] }
  | { status: "unchanged"; sku: string; listingId?: string }
  | { status: "not_found"; reason: string };

const ARTIST = ["artist", "artiste"];
const ALBUM = ["release title", "album", "album name", "titre de l'album"];
const YEAR = ["release year", "year", "année de sortie"];

const TITLE_MAX = 80;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Swaps the old artist and album for the new ones in an eBay title, keeping the rest (e.g. the grades). */
export function patchedTitle(title: string, from: { artist: string; title: string }, to: { artist: string; title: string }): string {
  let out = title;
  const swap = (a: string, b: string) => {
    if (!a.trim() || a.trim() === b.trim()) return;
    const re = new RegExp(escapeRe(a.trim()), "i");
    if (re.test(out)) out = out.replace(re, b.trim());
  };
  swap(from.artist, to.artist);
  swap(from.title, to.title);
  out = out.replace(/\s{2,}/g, " ").trim();
  return out.length > TITLE_MAX ? title : out;
}

/** Sets an item specific, under the name the listing already uses for it (or the first name given). */
export function setAspect(aspects: Record<string, string[]>, names: string[], value: string | undefined): Record<string, string[]> {
  const key = Object.keys(aspects).find((k) => names.includes(k.trim().toLowerCase()));
  const next = { ...aspects };
  if (!value) {
    if (key) delete next[key];
    return next;
  }
  next[key ?? names[0].replace(/\b\w/g, (c) => c.toUpperCase())] = [value];
  return next;
}

/** The SKU to edit: the one given, else the only live listing for the barcode. */
async function resolveSku(client: EbaySellClient, edit: CollectionEdit): Promise<{ sku: string; offer: Record<string, unknown> } | { reason: string }> {
  const live = (offers: Record<string, unknown>[]) => offers.find((o) => o.status === "PUBLISHED");
  if (edit.sku) {
    const offer = live(await client.getOffersRaw(edit.sku));
    if (offer) return { sku: edit.sku, offer };
  }
  const digits = edit.barcode?.replace(/\D/g, "");
  if (!digits) return { reason: "This CD has no live eBay listing to update." };
  const skus = (await client.findSkus(`BC-${digits}-`)).filter((s) => s !== edit.sku);
  const matches: { sku: string; offer: Record<string, unknown> }[] = [];
  for (const sku of skus.slice(0, 10)) {
    const offer = live(await client.getOffersRaw(sku));
    if (offer) matches.push({ sku, offer });
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { reason: `${matches.length} live eBay listings have this barcode, so none was changed. Edit it on eBay.` };
  return { reason: "No live eBay listing was found for this CD (it may have sold or ended)." };
}

export async function applyCollectionEdit(
  client: EbaySellClient,
  edit: CollectionEdit,
  defaults: { bestOfferMinPercent?: number; currency: string },
): Promise<EditResult> {
  const found = await resolveSku(client, edit);
  if ("reason" in found) return { status: "not_found", reason: found.reason };
  const { sku, offer } = found;
  const listingId = (offer.listing as { listingId?: string } | undefined)?.listingId;
  const changed: string[] = [];

  const { before, after } = edit;
  const textChanged = before.title !== after.title || before.artist !== after.artist || before.year !== after.year;
  if (textChanged) {
    const item = await client.getInventoryItemRaw(sku);
    if (!item) return { status: "not_found", reason: "eBay has no inventory item for this listing any more." };
    const product = { ...((item.product as Record<string, unknown>) ?? {}) };
    let aspects = { ...((product.aspects as Record<string, string[]>) ?? {}) };
    if (before.artist !== after.artist && after.artist.trim()) aspects = setAspect(aspects, ARTIST, after.artist.trim());
    if (before.title !== after.title && after.title.trim()) aspects = setAspect(aspects, ALBUM, after.title.trim());
    if (before.year !== after.year) aspects = setAspect(aspects, YEAR, after.year ? String(after.year) : undefined);
    const oldTitle = String(product.title ?? "");
    const newTitle = patchedTitle(oldTitle, before, after);
    product.aspects = aspects;
    product.title = newTitle;
    await client.putInventoryItemRaw(sku, { ...item, product });
    if (newTitle !== oldTitle) changed.push("title");
    changed.push("item specifics");
  }

  const price = after.price;
  const oldPrice = Number((offer.pricingSummary as { price?: { value?: string } } | undefined)?.price?.value);
  if (price !== undefined && price > 0 && Math.abs(price - oldPrice) >= 0.005) {
    const policies = { ...((offer.listingPolicies as Record<string, unknown>) ?? {}) };
    // Keep this listing's own auto-decline (and auto-accept) at the same share of the new price.
    policies.bestOfferTerms = rescaleBestOfferTerms(
      policies.bestOfferTerms as Record<string, unknown> | undefined,
      oldPrice,
      price,
      defaults.bestOfferMinPercent,
      defaults.currency,
    );
    if (policies.bestOfferTerms === undefined) delete policies.bestOfferTerms;
    const currency = (offer.pricingSummary as { price?: { currency?: string } } | undefined)?.price?.currency ?? defaults.currency;
    await client.putOfferRaw({
      ...offer,
      listingPolicies: policies,
      pricingSummary: { ...(offer.pricingSummary as object), price: { value: price.toFixed(2), currency } },
    });
    changed.push("price");
  }

  return changed.length ? { status: "updated", sku, listingId, changed } : { status: "unchanged", sku, listingId };
}
