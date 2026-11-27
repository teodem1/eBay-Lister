/**
 * Sold prices for a CD in the Collection: which saved price check to reuse
 * and the prices the seller can tap to set the CD's price. Pure, for tests.
 */
import { bestSuggestion, type PriceCheck } from "../pricing/priceCheck";
import { checkKey, type PriceFrom } from "../sort/worth";
import type { CollectionItem } from "./collection";

/** Search text for the CD, the same shape the Sort screen uses, so their saved checks are shared. */
export function collectionKeywords(item: Pick<CollectionItem, "artist" | "title">): string {
  return [item.artist, item.title].map((s) => s.trim()).filter(Boolean).join(" ");
}

/** Key into the phone's 30-day price-check cache. */
export function collectionCheckKey(item: Pick<CollectionItem, "artist" | "title" | "barcode">): string {
  return checkKey(collectionKeywords(item), item.barcode ?? "");
}

/** The same CD's key with no barcode: the shape Sort a pile caches its by-name checks under. */
export function collectionNameKey(item: Pick<CollectionItem, "artist" | "title">): string {
  return checkKey(collectionKeywords(item));
}

export interface PriceChoice {
  label: string;
  value: number;
}

/**
 * The prices to offer as one-tap choices: quick sale, recommended and high
 * from the sold copies, else from the current listings. Empty when neither found any.
 */
export function priceChoices(check: PriceCheck | undefined): { from: PriceFrom; choices: PriceChoice[] } | null {
  const best = bestSuggestion(check);
  if (!best) return null;
  const sold = best.from === "sold";
  const { quickSale, recommended, high } = best.suggestion.itemPrice;
  const choices = [
    { label: "Quick sale", value: quickSale },
    { label: sold ? "Typical sold" : "Typical listed", value: recommended },
    { label: "High", value: high },
  ]
    .filter((c) => Number.isFinite(c.value) && c.value > 0)
    .map((c) => ({ ...c, value: Math.round(c.value * 100) / 100 }))
    // Few comps can make two of them the same price: show it once.
    .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i);
  return { from: best.from, choices };
}
