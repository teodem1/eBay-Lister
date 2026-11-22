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

export const SOLD_COMPS_BASE = "https://api.sold-comps.com";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SoldCompsOptions {
  apiKey: string;
  /** eBay marketplace, e.g. EBAY_CA. Mapped to the provider's ebaySite. */
  marketplaceId: string;
  fetch?: FetchLike;
  now?: Date;
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

export function buildSoldCompsUrl(q: ComparableQuery, opts: SoldCompsOptions): string {
  const keyword = q.keywords?.trim() || q.gtin;
  if (!keyword) throw new Error("Sold search needs keywords or a barcode.");
  const since = new Date((opts.now ?? new Date()).getTime() - 90 * 86_400_000);
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
  };
}

export async function searchSoldComps(q: ComparableQuery, opts: SoldCompsOptions): Promise<Comparable[]> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(buildSoldCompsUrl(q, opts), {
    headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SoldCompsError(res.status, `sold-comps.com answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { items?: RawSoldItem[] };
  return (data.items ?? [])
    .map((r) => normaliseSoldCompsItem(r, q, homeCountry(opts.marketplaceId)))
    .filter((c): c is Comparable => c !== null);
}
