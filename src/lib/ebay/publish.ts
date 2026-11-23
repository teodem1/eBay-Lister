// Publish a reviewed draft: location -> inventory item -> offer -> publish (same flow as ebay_handler.py).
import type { ListingDraft } from "../listing/types";
import { EbayApiError, type EbaySellClient } from "./sell";

export interface PublishResult {
  sku: string;
  offerId: string;
  listingId: string;
}

export function aspectsToEbay(aspects: ListingDraft["aspects"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of aspects) {
    const name = a.name.trim();
    const values = a.value
      .split("|") // the review screen lets the user enter several values as "Red | Blue"
      .map((v) => v.trim())
      .filter(Boolean);
    if (!name || values.length === 0) continue;
    out[name] = [...(out[name] ?? []), ...values];
  }
  return out;
}

/**
 * Many categories refuse to publish without Brand and MPN item specifics
 * (25002 "Input data for tag <BrandMPN> is invalid or missing"), and eBay
 * refuses an MPN without a Brand. Fills both: Brand from the draft, else the
 * record label (CDs), else "Unbranded"; MPN from the draft, else "Does not apply".
 */
export function withBrandAndMpn(
  aspects: Record<string, string[]>,
  brand?: string,
  mpn?: string,
): Record<string, string[]> {
  const out = { ...aspects };
  const key = (name: string) => Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key("Brand")) out.Brand = [brand?.trim() || (out[key("Record Label") ?? ""] ?? [])[0] || "Unbranded"];
  if (!key("MPN")) out.MPN = [mpn?.trim() || "Does not apply"];
  return out;
}

/** EAN is 8 or 13 digits, UPC is 12. Anything else is not sent as a product identifier. */
export function barcodeIdentifiers(barcode?: string): { ean?: string[]; upc?: string[] } {
  const digits = barcode?.replace(/\D/g, "") ?? "";
  if (digits.length === 12) return { upc: [digits] };
  if (digits.length === 13 || digits.length === 8) return { ean: [digits] };
  return {};
}

/** Item specifics without Brand and MPN (music: eBay doesn't need them for CDs). */
export function withoutBrandAndMpn(aspects: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(aspects).filter(([k]) => !/^(brand|mpn)$/i.test(k.trim())));
}

/** CDs and other music: listed by barcode and record label, no Brand / MPN. */
export function isMusicDraft(draft: Pick<ListingDraft, "categoryName" | "title">): boolean {
  return /\bmusic\b|\bcds?\b|\brecords\b|\bcassettes\b/i.test(`${draft.categoryName ?? ""} ${draft.title}`);
}

/** eBay's 25002 "Input data for tag <BrandMPN> is invalid or missing". */
export function isBrandMpnError(err: unknown): boolean {
  return err instanceof EbayApiError && /BrandMPN/i.test(err.message);
}

export async function publishListing(
  client: EbaySellClient,
  draft: ListingDraft,
  defaults: { bestOfferMinPercent?: number } = {},
): Promise<PublishResult> {
  const locationKey = await client.ensureLocation();
  const base = aspectsToEbay(draft.aspects);

  // Brand and MPN are left empty for a CD; other items get them filled in.
  // If eBay answers 25002 (BrandMPN), the other way is tried once.
  const putItem = (withBrand: boolean) => {
    const aspects = withBrand ? withBrandAndMpn(base, draft.brand, draft.mpn) : withoutBrandAndMpn(base);
    const brandKey = Object.keys(aspects).find((k) => k.toLowerCase() === "brand");
    return client.putInventoryItem({
      sku: draft.sku,
      title: draft.title,
      descriptionHtml: draft.descriptionHtml,
      condition: draft.condition,
      conditionDescription: draft.conditionDescription,
      aspects,
      imageUrls: draft.imageUrls,
      quantity: draft.quantity,
      // The product's brand and MPN must agree with the item specifics.
      brand: withBrand && brandKey ? aspects[brandKey][0] : undefined,
      mpn: withBrand ? draft.mpn?.trim() || undefined : undefined,
      package: { weightKg: draft.packageWeightKg, dimensionsCm: draft.packageDimensionsCm },
      ...barcodeIdentifiers(draft.barcode),
    });
  };
  let withBrand = !isMusicDraft(draft);
  await putItem(withBrand);

  const offerId = await client.upsertOffer(
    {
      sku: draft.sku,
      categoryId: draft.categoryId,
      price: draft.price,
      quantity: draft.quantity,
      descriptionHtml: draft.descriptionHtml,
      bestOfferMinPercent: draft.bestOfferMinPercent ?? defaults.bestOfferMinPercent,
    },
    locationKey,
  );

  let listingId: string;
  try {
    listingId = await client.publishOffer(offerId);
  } catch (err) {
    if (!isBrandMpnError(err)) throw err;
    withBrand = !withBrand;
    await putItem(withBrand);
    listingId = await client.publishOffer(offerId);
  }
  return { sku: draft.sku, offerId, listingId };
}
