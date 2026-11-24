/**
 * Sold prices from sold-comps.com, a third-party API (not eBay).
 *
 * Used for the "Last sold" price when the app has no Marketplace Insights
 * access. sold-comps.com collects eBay's public sold-search results itself
 * (scraping); eBay does not provide or endorse this data.
 *
 * Docs: https://sold-comps.com/docs
 *   GET https://api.sold-comps.com/v1/scrape?keyword=...&ebaySite=ebay.ca
 *   Authorization: Bearer sc_...
 * Pricing (Nov 2026): free 100 requests/month, $9/month for 2,000. One call
 * here is one request.
 *
 * Checked against the live API (Nov 2026, ebay.ca): prices are decimal
 * strings ("286.88") in soldCurrency, shipping has its own shippingCurrency,
 * free shipping comes as shippingPrice null with shippingType "free", endedAt
 * is YYYY-MM-DD, and itemLocation is a bare country name ("United States").
 * itemLocation is null when eBay shows no "from <country>" line, which it
 * only shows for items outside the site's country, so null means domestic.
 * The docs do not list a GTIN parameter, so a barcode is only sent as the
 * keyword when there is no item text.
 */
import type { Comparable, ComparableQuery } from "./types";
import { cdKeywords } from "../pricing/version";

export const SOLD_COMPS_BASE = "https://api.sold-comps.com";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SoldCompsOptions {
  apiKey: string;
  /** eBay marketplace, e.g. EBAY_CA. Mapped to the provider's ebaySite. */
  marketplaceId: string;
  fetch?: FetchLike;
  now?: Date;
  /** How far back to ask for sales. eBay's own sold search keeps about 90 days, so older sales may not exist. */
  lookbackDays?: number;
  /** Called with the lookups left this period when the answer carries a rate-limit header. */
  onRemaining?: (left: number) => void;
}

export const DEFAULT_SOLD_LOOKBACK_DAYS = 365;

/** SOLD_LOOKBACK_DAYS from the environment, 30 to 1095 days; default 365. */
export function soldLookbackDays(value?: string): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 30 && n <= 1095 ? n : DEFAULT_SOLD_LOOKBACK_DAYS;
}

/** EBAY_CA -> "CA". The site's home country, for items with no location. */
export const homeCountry = (marketplaceId: string): string | null =>
  /^EBAY_([A-Z]{2})$/.exec(marketplaceId)?.[1] ?? null;

const SITE_BY_MARKETPLACE: Record<string, string> = {
  EBAY_US: "ebay.com",
  EBAY_CA: "ebay.ca",
  EBAY_GB: "ebay.co.uk",
  EBAY_DE: "ebay.de",
  EBAY_FR: "ebay.fr",
  EBAY_IT: "ebay.it",
  EBAY_ES: "ebay.es",
  EBAY_AU: "ebay.com.au",
};

/** Country names the provider returns in itemLocation, mapped to ISO codes. */
const COUNTRY_CODES: Record<string, string> = {
  canada: "CA",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  china: "CN",
  "hong kong": "HK",
  japan: "JP",
  australia: "AU",
  germany: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  taiwan: "TW",
  "south korea": "KR",
};

/** Shown when the sold-comps.com monthly allowance is used up. */
export const SOLD_LIMIT_NOTE =
  "Your sold-price lookups for this month (sold-comps.com) are used up. Prices come from current listings only " +
  "until the allowance resets, or upgrade the sold-comps.com plan.";

/** True when sold-comps.com refused because the plan's allowance is used up (429/402, or a 403 that says so). */
export function isSoldCompsLimit(err: unknown): boolean {
  if (!(err instanceof SoldCompsError)) return false;
  if (err.status === 429 || err.status === 402) return true;
  return err.status === 403 && /limit|quota|credit|exceed|usage|upgrade/i.test(err.message);
}

/** Lookups left from the usual rate-limit headers, when the provider sends one. */
export function remainingFromHeaders(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined;
  for (const name of ["x-ratelimit-remaining", "ratelimit-remaining", "x-quota-remaining", "x-requests-remaining", "x-credits-remaining"]) {
    const v = headers.get(name);
    if (v === null) continue;
    const n = Number(v.split(/[;,]/)[0].trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

export class SoldCompsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SoldCompsError";
  }
}

interface RawSoldItem {
  itemId?: string | number;
  url?: string;
  title?: string;
  condition?: string;
  soldPrice?: string | number;
  soldCurrency?: string;
  shippingPrice?: string | number | null;
  shippingCurrency?: string | null;
  shippingType?: string;
  endedAt?: string;
  itemLocation?: string | null;
  imageUrl?: string | null;
  image?: string | null;
  thumbnail?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "Toronto, Ontario, Canada" or "Canada" -> "CA". Unknown names -> null. */
export function countryCode(location: string | null | undefined): string | null {
  if (!location) return null;
  const last = location.split(",").pop()!.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(last)) return last.toUpperCase();
  return COUNTRY_CODES[last] ?? null;
}

/**
 * The barcode as eBay's web search matches it: the bare 12-digit UPC (an
 * EAN-13 starting with 0 is the same UPC), else the digits as scanned.
 * Listings tagged with that barcode come back, so only that exact pressing.
 * ("UPC0756..." as eBay's app types it found 0 sales through sold-comps.com
 * in a live test on 2026-11-23, so bare digits are used.)
 */
export function barcodeKeyword(gtin: string): string {
  const d = gtin.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("0")) return d.slice(1);
  return d;
}

export function buildSoldCompsUrl(
  q: ComparableQuery,
  opts: SoldCompsOptions & { by?: "barcode" | "keywords" },
): string {
  const keyword =
    opts.by === "barcode" && q.gtin
      ? barcodeKeyword(q.gtin)
      : (q.keywords?.trim() && cdKeywords(q.keywords, { exclude: true })) || (q.gtin && barcodeKeyword(q.gtin));
  if (!keyword) throw new Error("Sold search needs keywords or a barcode.");
  const days = opts.lookbackDays ?? DEFAULT_SOLD_LOOKBACK_DAYS;
  const since = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000);
  const params = new URLSearchParams({
    keyword,
    ebaySite: SITE_BY_MARKETPLACE[opts.marketplaceId] ?? "ebay.com",
    count: "120",
    soldAfter: since.toISOString().slice(0, 10),
  });
  if (q.destinationPostalCode) params.set("postalCode", q.destinationPostalCode);
  return `${SOLD_COMPS_BASE}/v1/scrape?${params}`;
}

/**
 * `siteCountry` is the marketplace's country (e.g. "CA" for ebay.ca); it is
 * used when the provider gives no itemLocation (see the note at the top).
 */
export function normaliseSoldCompsItem(
  raw: RawSoldItem,
  q: ComparableQuery,
  siteCountry: string | null = null,
): Comparable | null {
  const price = num(raw.soldPrice);
  if (raw.itemId === undefined || price === null) return null;
  const currency = raw.soldCurrency ?? "";
  const ship = raw.shippingType === "free" ? 0 : num(raw.shippingPrice);
  return {
    itemId: String(raw.itemId),
    title: raw.title ?? "",
    price: { value: price, currency },
    shippingCost: ship === null ? null : { value: ship, currency: raw.shippingCurrency || currency },
    itemLocation: {
      country: raw.itemLocation ? countryCode(raw.itemLocation) : siteCountry,
      postalCode: null,
    },
    shippingDestination: q.destinationCountry ?? null,
    condition: raw.condition ?? null,
    soldDate: raw.endedAt ?? null,
    quantitySold: 1,
    url: raw.url ?? null,
    imageUrl: findImageUrl(raw),
  };
}

/**
 * The item's photo. The provider's docs don't name an image field, so known
 * names are tried first, then any https value that looks like an image
 * (i.ebayimg.com or an image file), including inside nested objects or lists.
 */
export function findImageUrl(raw: unknown): string | null {
  const r = raw as Record<string, unknown>;
  for (const k of ["imageUrl", "image", "thumbnail", "thumbnailUrl", "galleryUrl", "pictureUrl", "img"]) {
    const v = r?.[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  const looksLikeImage = (v: string) =>
    /^https?:\/\//.test(v) && (/ebayimg\.com/i.test(v) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(v));
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | null => {
    if (typeof v === "string") return looksLikeImage(v) ? v : null;
    if (!v || typeof v !== "object" || depth > 3 || seen.has(v)) return null;
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const found = walk(x, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(raw, 0);
}

export async function searchSoldComps(
  q: ComparableQuery,
  opts: SoldCompsOptions & { by?: "barcode" | "keywords" },
): Promise<Comparable[]> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(buildSoldCompsUrl(q, opts), {
    headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
  });
  const left = remainingFromHeaders(res.headers);
  if (left !== undefined) opts.onRemaining?.(left);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SoldCompsError(res.status, `sold-comps.com answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { items?: RawSoldItem[] };
  return (data.items ?? [])
    .map((r) => normaliseSoldCompsItem(r, q, homeCountry(opts.marketplaceId)))
    .filter((c): c is Comparable => c !== null);
}
