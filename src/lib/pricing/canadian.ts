/**
 * "Canadian Version" in the title: every CD the seller lists was bought in Canada,
 * and when copies titled Canadian sold for more than the others, saying so in the
 * listing is worth money. Pure, so screens and tests share it.
 */
import type { Comparable } from "../ebay/types";

/** A title that names the Canadian version ("Canadian", "Canada", "CDN"). */
export const CANADIAN_TITLE = /\b(canad(a|ian)|cdn)\b/i;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * True when a sold copy titled Canadian sold for more than the typical (median)
 * copy that wasn't, or when the only sold copies are Canadian ones.
 */
export function canadianSoldForMore(sold: Comparable[] | undefined): boolean {
  const priced = (sold ?? []).filter((c) => Number.isFinite(c.price?.value) && c.price.value > 0);
  const canadian = priced.filter((c) => CANADIAN_TITLE.test(c.title));
  if (canadian.length === 0) return false;
  const others = priced.filter((c) => !CANADIAN_TITLE.test(c.title));
  if (others.length === 0) return true;
  const typical = median(others.map((c) => c.price.value));
  return canadian.some((c) => c.price.value > typical);
}
