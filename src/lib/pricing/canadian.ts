/**
 * "Canadian Version" in the title: every CD the seller lists was bought in Canada,
 * and when copies titled Canadian sold for more than the others, saying so in the
 * listing is worth money. Pure, so screens and tests share it.
 */
import type { Comparable } from "../ebay/types";
import { CANADIAN_TITLE, editionPrice } from "./edition";

export { CANADIAN_TITLE };

/**
 * True when the copies titled Canadian typically (median) sold for more than the
 * typical copy that wasn't, or when the only sold copies are Canadian ones.
 * The same test as the Canadian edition price, so one high outlier among cheap
 * Canadian copies doesn't put "Canadian Version" in the title.
 */
export function canadianSoldForMore(sold: Comparable[] | undefined): boolean {
  return editionPrice(sold, "canadian") !== null;
}
