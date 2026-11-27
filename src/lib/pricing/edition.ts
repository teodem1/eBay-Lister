/**
 * Special editions (no barcode, Canadian version, early press...) can sell for
 * more than the usual copy. When Claude recognises the seller's copy as one,
 * the sold copies titled as that edition set the price, if they sold higher.
 * Pure, so the listing screen, the Auto tab, Update live listings and tests share it.
 */
import type { Comparable } from "../ebay/types";

export const EDITIONS = ["none", "canadian", "no_barcode", "early_press", "promo", "club", "limited", "japan"] as const;
export type Edition = (typeof EDITIONS)[number];

/** What a sold listing's title says when it is that edition. */
const TITLE: Record<Exclude<Edition, "none">, RegExp> = {
  canadian: /\b(canad(a|ian)|cdn)\b/i,
  no_barcode: /\bno[\s-]*(upc|bar[\s-]*code)\b|\bbarcode[\s-]*less\b|\bwithout (a )?(upc|bar[\s-]*code)\b/i,
  early_press: /\b(early|first|1st|original|orig\.?) (press(ing)?|issue|edition)\b|\btarget cd\b|\bwest germany\b/i,
  promo: /\bpromo(tional)?\b/i,
  club: /\b(club edition|bmg|columbia house|crc)\b/i,
  limited: /\b(limited|ltd\.?|numbered)( edition)?\b/i,
  japan: /\bjapan(ese)?\b|\bobi\b/i,
};

export const EDITION_LABEL: Record<Exclude<Edition, "none">, string> = {
  canadian: "Canadian",
  no_barcode: "no-barcode",
  early_press: "early press",
  promo: "promo",
  club: "club edition",
  limited: "limited edition",
  japan: "Japan",
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface EditionPrice {
  edition: Exclude<Edition, "none">;
  /** Typical (median) price of the sold copies titled as this edition. */
  price: number;
  count: number;
  low: number;
  high: number;
  /** One line for the seller, e.g. "3 no-barcode copies sold for $17.00-$22.00". */
  reason: string;
}

/**
 * The edition's price from sold copies titled as that edition, only when they sold
 * above the typical other copy (or are the only copies). Null otherwise.
 */
export function editionPrice(sold: Comparable[] | undefined, edition: Edition | undefined): EditionPrice | null {
  if (!edition || edition === "none") return null;
  const re = TITLE[edition];
  const priced = (sold ?? []).filter((c) => Number.isFinite(c.price?.value) && c.price.value > 0);
  const same = priced.filter((c) => re.test(c.title)).map((c) => c.price.value);
  if (same.length === 0) return null;
  const others = priced.filter((c) => !re.test(c.title)).map((c) => c.price.value);
  const price = Math.round(median(same) * 100) / 100;
  if (others.length && price <= median(others)) return null;
  const low = Math.min(...same);
  const high = Math.max(...same);
  const money = (n: number) => `$${n.toFixed(2)}`;
  const n = same.length;
  return {
    edition,
    price,
    count: n,
    low,
    high,
    reason: `${n} ${EDITION_LABEL[edition]} ${n === 1 ? "copy" : "copies"} sold for ${low === high ? money(low) : `${money(low)}-${money(high)}`}`,
  };
}
