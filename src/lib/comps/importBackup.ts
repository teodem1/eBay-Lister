/**
 * Imports the price checks saved in the phone's Collection backup as stored
 * lookups. A backup check is trimmed (the latest sales only), so it is marked
 * partial and never replaces a full lookup. Storage that cannot be read stops
 * the import (rejects).
 */
import { z } from "zod";
import { CONDITIONS } from "../ebay/conditions";
import type { Comparable } from "../ebay/types";
import { saveLookup, type Backend } from "./store";

const MAX_ITEMS = 300;

const Money = z.object({ value: z.number().finite(), currency: z.string().min(1).max(10) });

/** One sale from a backup check: id, title and price required, the rest filled when missing. */
const Sale = z.object({
  itemId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  price: Money,
  shippingCost: Money.nullable().default(null),
  itemLocation: z
    .object({ country: z.string().nullable().default(null), postalCode: z.string().nullable().default(null) })
    .default({ country: null, postalCode: null }),
  shippingDestination: z.string().nullable().default(null),
  condition: z.string().nullable().default(null),
  soldDate: z.string().nullable().default(null),
  quantitySold: z.number().int().min(1).default(1),
  url: z.string().nullable().default(null),
  imageUrl: z.string().nullable().optional(),
}) satisfies z.ZodType<Comparable, unknown>;

const Item = z.object({
  barcode: z.string().max(20).optional(),
  priceCheckedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a date."),
  priceCheck: z.object({
    keywords: z.string().max(300),
    condition: z.enum(CONDITIONS).optional(),
    soldItems: z.array(Sale).max(200).optional(),
  }),
});

export const ImportBody = z.object({ items: z.array(Item).max(MAX_ITEMS) });
export type ImportItem = z.infer<typeof Item>;

export async function importBackup(
  b: Backend,
  items: ImportItem[],
): Promise<{ saved: number; kept: number; skipped: number }> {
  const counts = { saved: 0, kept: 0, skipped: 0 };
  for (const it of items) {
    const sales = it.priceCheck.soldItems ?? [];
    if (!sales.length) {
      counts.skipped++;
      continue;
    }
    const result = await saveLookup(b, {
      savedAt: new Date(it.priceCheckedAt).toISOString(),
      partial: true,
      barcode: it.barcode,
      name: it.priceCheck.keywords,
      condition: it.priceCheck.condition,
      queries: [{ by: "keywords", items: sales }],
    });
    if (result === "saved") counts.saved++;
    else if (result === "kept") counts.kept++;
    else counts.skipped++;
  }
  return counts;
}
