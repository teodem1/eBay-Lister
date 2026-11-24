/**
 * Discogs price guide, a second opinion for collectible CDs (eBay sales are
 * thin or cheap copies drag them down).
 *
 * API (https://www.discogs.com/developers), with a personal access token
 * (DISCOGS_TOKEN, from discogs.com/settings/developers; free):
 *   GET /database/search?barcode=...&type=release   -> the release for this pressing
 *   GET /marketplace/price_suggestions/{release_id} -> a price per condition ("Near Mint (NM or M-)": {value, currency}),
 *       in the token owner's selling currency; needs their Discogs seller settings filled in, else 4xx (skipped)
 *   GET /marketplace/stats/{release_id}?curr_abbr=CAD -> lowest price on Discogs now and how many are for sale
 * Discogs asks for a User-Agent and allows 60 requests a minute with a token.
 * Written from the docs: the container that built it can't reach api.discogs.com.
 */
import type { Grade } from "../listing/condition";

export const DISCOGS_BASE = "https://api.discogs.com";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface DiscogsReference {
  releaseId: number;
  title: string;
  year?: string;
  country?: string;
  url: string;
  /** Collectors who own it and who want it: a rough demand signal. */
  have?: number;
  want?: number;
  /** Discogs' suggested price for each condition, e.g. { "Near Mint (NM or M-)": 24.5 }. */
  suggestions: Record<string, number>;
  suggestionCurrency?: string;
  lowest?: { value: number; currency: string };
  numForSale?: number;
}

/** Our grades on Discogs' condition scale. */
export const DISCOGS_CONDITION: Record<Grade, string> = {
  Mint: "Mint (M)",
  "Near mint": "Near Mint (NM or M-)",
  "Very good+": "Very Good Plus (VG+)",
  "Very good": "Very Good (VG)",
  Good: "Good (G)",
  Fair: "Fair (F)",
  Poor: "Poor (P)",
};

export async function discogsReference(
  barcode: string,
  opts: { token: string; fetchImpl?: FetchLike; currency?: string },
): Promise<DiscogsReference | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Discogs token=${opts.token}`, "User-Agent": "eBayLister/1.0", Accept: "application/json" };
  const get = async (path: string) => {
    const res = await fetchImpl(`${DISCOGS_BASE}${path}`, { headers });
    if (!res.ok) throw Object.assign(new Error(`Discogs ${res.status}`), { status: res.status });
    return res.json();
  };

  const digits = barcode.replace(/\D/g, "");
  if (!digits) return null;
  const search = await get(`/database/search?${new URLSearchParams({ barcode: digits, type: "release", per_page: "10" })}`);
  type Hit = { id: number; title?: string; year?: string; country?: string; uri?: string; format?: string[]; community?: { have?: number; want?: number } };
  const hits: Hit[] = search?.results ?? [];
  // The CD pressing when the barcode is shared with other formats.
  const hit = hits.find((h) => h.format?.some((f) => /^CD$/i.test(f))) ?? hits[0];
  if (!hit) return null;

  const [suggestions, stats] = await Promise.all([
    get(`/marketplace/price_suggestions/${hit.id}`).catch(() => null),
    get(`/marketplace/stats/${hit.id}?curr_abbr=${opts.currency ?? "CAD"}`).catch(() => null),
  ]);
  const prices: Record<string, number> = {};
  let suggestionCurrency: string | undefined;
  for (const [cond, v] of Object.entries((suggestions ?? {}) as Record<string, { value?: number; currency?: string }>)) {
    if (typeof v?.value === "number" && v.value > 0) {
      prices[cond] = Math.round(v.value * 100) / 100;
      suggestionCurrency ??= v.currency;
    }
  }
  const lowest = stats?.lowest_price;
  return {
    releaseId: hit.id,
    title: hit.title ?? "",
    year: hit.year,
    country: hit.country,
    url: hit.uri ? (hit.uri.startsWith("http") ? hit.uri : `https://www.discogs.com${hit.uri}`) : `https://www.discogs.com/release/${hit.id}`,
    have: hit.community?.have,
    want: hit.community?.want,
    suggestions: prices,
    suggestionCurrency,
    lowest: typeof lowest?.value === "number" ? { value: lowest.value, currency: lowest.currency ?? opts.currency ?? "CAD" } : undefined,
    numForSale: typeof stats?.num_for_sale === "number" ? stats.num_for_sale : undefined,
  };
}

/** Discogs' suggested price for the CD's grade (the worse of disc and inlay; sealed = Mint). */
export function discogsPriceFor(ref: DiscogsReference, grade: Grade | undefined): number | undefined {
  return grade ? ref.suggestions[DISCOGS_CONDITION[grade]] : undefined;
}

/** The Discogs reference as text for Claude's price pick. */
export function discogsEvidence(ref: DiscogsReference, grade: Grade | undefined): string {
  const cur = ref.suggestionCurrency ?? "CAD";
  const lines = [`Discogs price guide for this pressing (${[ref.title, ref.country, ref.year].filter(Boolean).join(", ")}):`];
  const mine = discogsPriceFor(ref, grade);
  if (mine !== undefined) lines.push(`- Suggested price for the seller's grade (${DISCOGS_CONDITION[grade!]}): ${mine.toFixed(2)} ${cur}`);
  const others = Object.entries(ref.suggestions).filter(([c]) => !grade || c !== DISCOGS_CONDITION[grade]);
  if (others.length) lines.push(`- Other grades: ${others.map(([c, v]) => `${c} ${v.toFixed(2)}`).join("; ")} ${cur}`);
  if (ref.lowest) lines.push(`- Lowest listed on Discogs now: ${ref.lowest.value.toFixed(2)} ${ref.lowest.currency} (${ref.numForSale ?? "?"} for sale)`);
  if (ref.have !== undefined || ref.want !== undefined) lines.push(`- Collectors: ${ref.have ?? "?"} have it, ${ref.want ?? "?"} want it`);
  lines.push("Discogs prices exclude shipping and are asking/suggested prices, not eBay sales.");
  return lines.join("\n");
}
