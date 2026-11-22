// Publish a reviewed draft: location -> inventory item -> offer -> publish (same flow as ebay_handler.py).
import type { ListingDraft } from "../listing/types";
import type { EbaySellClient } from "./sell";

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
 * (25002 "Input data for tag <BrandMPN> is invalid or missing").
 * Fills them from the draft, with eBay's "Does not apply" for an unknown MPN.
 */
export function withBrandAndMpn(
  aspects: Record<string, string[]>,
  brand?: string,
  mpn?: string,
): Record<string, string[]> {
  const out = { ...aspects };
  const has = (name: string) => Object.keys(out).some((k) => k.toLowerCase() === name.toLowerCase());
  if (!has("Brand") && brand?.trim()) out.Brand = [brand.trim()];
  if (!has("MPN")) out.MPN = [mpn?.trim() || "Does not apply"];
  return out;
}

/** EAN is 8 or 13 digits, UPC is 12. Anything else is not sent as a product identifier. */
export function barcodeIdentifiers(barcode?: string): { ean?: string[]; upc?: string[] } {
  const digits = barcode?.replace(/\D/g, "") ?? "";
  if (digits.length === 12) return { upc: [digits] };
  if (digits.length === 13 || digits.length === 8) return { ean: [digits] };
  return {};
}

export async function publishListing(client: EbaySellClient, draft: ListingDraft): Promise<PublishResult> {
  const locationKey = await client.ensureLocation();

  await client.putInventoryItem({
    sku: draft.sku,
    title: draft.title,
    descriptionHtml: draft.descriptionHtml,
    condition: draft.condition,
    conditionDescription: draft.conditionDescription,
    aspects: withBrandAndMpn(aspectsToEbay(draft.aspects), draft.brand, draft.mpn),
    imageUrls: draft.imageUrls,
    quantity: draft.quantity,
    brand: draft.brand,
    mpn: draft.mpn,
    package: { weightKg: draft.packageWeightKg, dimensionsCm: draft.packageDimensionsCm },
    ...barcodeIdentifiers(draft.barcode),
  });

  const offerId = await client.upsertOffer(
    {
      sku: draft.sku,
      categoryId: draft.categoryId,
      price: draft.price,
      quantity: draft.quantity,
      descriptionHtml: draft.descriptionHtml,
    },
    locationKey,
  );

  const listingId = await client.publishOffer(offerId);
  return { sku: draft.sku, offerId, listingId };
}
