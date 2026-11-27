/**
 * Fetch comparable listings for an item.
 *
 * Preferred source: Marketplace Insights API `item_sales/search`, which
 * returns items sold in the last 90 days. It is a Limited Release API: eBay
 * must approve the app before the token scope is granted.
 *
 * Fallback: Browse API `item_summary/search`, open to every keyset. It only
 * returns ACTIVE listings, so prices are asking prices, not sold prices.
 *
 * The old Finding API `findCompletedItems` was decommissioned by eBay in
 * 2025, so it is not used.
 */
import {
  EbayApiError,
  SCOPE_MARKETPLACE_INSIGHTS,
  SCOPE_PUBLIC,
  type EbayClient,
} from "./client";
import type {
  Comparable,
  ComparableQuery,
  ComparableResult,
  Money,
} from "./types";
import { isSoldCompsLimit, searchSoldComps, SOLD_LIMIT_NOTE, type SoldCompsOptions } from "./soldComps";
import { cdKeywords } from "../pricing/version";

// ---- Raw eBay response shapes (only the fields we use) ----

interface RawAmount {
  value?: string;
  currency?: string;
}
interface RawShippingOption {
  shippingCost?: RawAmount;
  shippingCostType?: string;
}
interface RawItem {
  itemId?: string;
  title?: string;
  price?: RawAmount;
  lastSoldPrice?: RawAmount;
  lastSoldDate?: string;
  totalSoldQuantity?: number;
  condition?: string;
  itemLocation?: { country?: string; postalCode?: string };
  shippingOptions?: RawShippingOption[];
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
}
interface RawSalesResponse {
  itemSales?: RawItem[];
}
interface RawBrowseResponse {
  itemSummaries?: RawItem[];
}

// ---- Request building ----

/** Builds the eBay `filter` param shared by both APIs. */
export function buildFilter(q: ComparableQuery): string | undefined {
  const parts: string[] = [];
  if (q.conditionIds?.length) parts.push(`conditionIds:{${q.conditionIds.join("|")}}`);
  if (q.itemLocationCountries?.length === 1) {
    // eBay only accepts a single itemLocationCountry; multi-country is
    // filtered client-side below.
    parts.push(`itemLocationCountry:${q.itemLocationCountries[0]}`);
  }
  // GUESS: deliveryCountry is documented for Browse; we assume
  // Marketplace Insights accepts it too. Drop it if eBay rejects it.
  if (q.destinationCountry) parts.push(`deliveryCountry:${q.destinationCountry}`);
  return parts.length ? parts.join(",") : undefined;
}

/** X-EBAY-C-ENDUSERCTX value so shipping costs are quoted to the buyer's location. */
export function buildEndUserCtx(q: ComparableQuery): string | undefined {
  if (!q.destinationCountry) return undefined;
  const loc = [`country=${q.destinationCountry}`];
  if (q.destinationPostalCode) loc.push(`zip=${q.destinationPostalCode}`);
  return `contextualLocation=${encodeURIComponent(loc.join(","))}`;
}

function searchParams(q: ComparableQuery): Record<string, string | undefined> {
  if (!q.keywords && !q.gtin && !q.epid && !q.categoryId) {
    throw new Error("Comparable search needs keywords, gtin, epid or categoryId.");
  }
  return {
    // A GTIN/EPID match is much more precise than keywords, so prefer it.
    q: q.gtin || q.epid ? undefined : q.keywords && cdKeywords(q.keywords),
    gtin: q.gtin,
    epid: q.epid,
    category_ids: q.categoryId,
    filter: buildFilter(q),
    limit: String(Math.min(q.limit ?? 100, 200)),
  };
}

// ---- Normalisation ----

function toMoney(a: RawAmount | undefined): Money | null {
  if (!a?.value) return null;
  const value = Number(a.value);
  if (!Number.isFinite(value)) return null;
  return { value, currency: a.currency ?? "" };
}

/** Cheapest quoted shipping option, or null if none has a cost. */
function cheapestShipping(opts: RawShippingOption[] | undefined): Money | null {
  let best: Money | null = null;
  for (const o of opts ?? []) {
    const m = toMoney(o.shippingCost);
    if (m && (!best || m.value < best.value)) best = m;
  }
  return best;
}

export function normaliseItem(
  raw: RawItem,
  kind: "sold" | "active",
  q: ComparableQuery,
): Comparable | null {
  const price = toMoney(kind === "sold" ? raw.lastSoldPrice ?? raw.price : raw.price);
  if (!raw.itemId || !price) return null;
  return {
    itemId: raw.itemId,
    title: raw.title ?? "",
    price,
    shippingCost: cheapestShipping(raw.shippingOptions),
    itemLocation: {
      country: raw.itemLocation?.country ?? null,
      postalCode: raw.itemLocation?.postalCode ?? null,
    },
    shippingDestination: q.destinationCountry ?? null,
    condition: raw.condition ?? null,
    soldDate: kind === "sold" ? raw.lastSoldDate ?? null : null,
    quantitySold: kind === "sold" ? Math.max(1, raw.totalSoldQuantity ?? 1) : 1,
    url: raw.itemWebUrl ?? raw.itemAffiliateWebUrl ?? null,
    imageUrl: raw.thumbnailImages?.[0]?.imageUrl ?? raw.image?.imageUrl ?? null,
  };
}

function normaliseAll(
  raws: RawItem[] | undefined,
  kind: "sold" | "active",
  q: ComparableQuery,
): Comparable[] {
  const countries = q.itemLocationCountries;
  return (raws ?? [])
    .map((r) => normaliseItem(r, kind, q))
    .filter((c): c is Comparable => c !== null)
    .filter(
      (c) =>
        !countries?.length ||
        (c.itemLocation.country !== null && countries.includes(c.itemLocation.country)),
    );
}

// ---- Public API ----

export async function searchSold(
  client: EbayClient,
  q: ComparableQuery,
): Promise<Comparable[]> {
  const res = await client.get<RawSalesResponse>(
    "/buy/marketplace_insights/v1_beta/item_sales/search",
    searchParams(q),
    { scope: SCOPE_MARKETPLACE_INSIGHTS, endUserCtx: buildEndUserCtx(q) },
  );
  return normaliseAll(res.itemSales, "sold", q);
}

export async function searchActive(
  client: EbayClient,
  q: ComparableQuery,
): Promise<Comparable[]> {
  const res = await client.get<RawBrowseResponse>(
    "/buy/browse/v1/item_summary/search",
    searchParams(q),
    { scope: SCOPE_PUBLIC, endUserCtx: buildEndUserCtx(q) },
  );
  return normaliseAll(res.itemSummaries, "active", q);
}

/** Current listings with the item's barcode; by name when too few carry it. */
async function searchActiveAny(
  client: EbayClient,
  q: ComparableQuery,
): Promise<{ items: Comparable[]; notes: string[]; matchedBy: ComparableResult["matchedBy"] }> {
  const items = await searchActive(client, q);
  if (!q.gtin) return { items, notes: [], matchedBy: "keywords" };
  if (items.length >= MIN_BARCODE_MATCHES || !hasName(q)) {
    return { items, notes: [`Listings with this exact barcode (${q.gtin}).`], matchedBy: "barcode" };
  }
  const byName = await searchActive(client, { ...q, gtin: undefined });
  return {
    items: byName,
    notes: [`Only ${items.length} listings carry this barcode, so listings were found by name.`],
    matchedBy: "keywords",
  };
}

/** True when the error means "this app is not approved for Marketplace Insights". */
export function isAccessDenied(err: unknown): boolean {
  if (!(err instanceof EbayApiError)) return false;
  if (err.status === 401 || err.status === 403) return true;
  // Token endpoint answers 400 invalid_scope for scopes the app doesn't have.
  return err.status === 400 && err.body.includes("invalid_scope");
}

/**
 * Sold comparables when the app has Marketplace Insights access, otherwise
 * active listings from the Browse API, with a note saying so.
 */
export async function findComparables(
  client: EbayClient,
  q: ComparableQuery,
): Promise<ComparableResult> {
  const marketplaceId = client.config.marketplaceId;
  try {
    const items = await searchSold(client, q);
    return { source: "marketplace_insights", marketplaceId, items, notes: [] };
  } catch (err) {
    if (!isAccessDenied(err)) throw err;
  }
  const items = await searchActive(client, q);
  return {
    source: "browse_active",
    marketplaceId,
    items,
    notes: [
      "Sold-price data is not available for this eBay app (Marketplace Insights needs eBay approval). " +
        "Prices below are current asking prices from active listings, which usually run higher than what items sell for.",
    ],
  };
}

export interface BothComparables {
  /** Active listings right now (Browse API). Null only if that search failed. */
  current: ComparableResult | null;
  /** Items sold in the last 90 days (Marketplace Insights). Null when unavailable. */
  sold: ComparableResult | null;
  /** Why `current` or `sold` is missing, for the user. */
  unavailable: { current?: string; sold?: string };
  /** The sold-comps.com monthly allowance is used up. */
  soldLimitReached?: boolean;
  /** sold-comps.com lookups left, when it says. */
  soldRemaining?: number;
}

export const SOLD_ACCESS_NOTE =
  "eBay only gives sold prices to apps it approves for its Marketplace Insights API, and this app is not approved. " +
  "Add a SOLD_COMPS_API_KEY (sold-comps.com) to get sold prices from a third-party service.";

export interface BothOptions {
  /** sold-comps.com key; used for sold prices when Marketplace Insights is refused. */
  soldCompsApiKey?: string;
  soldCompsFetch?: SoldCompsOptions["fetch"];
  /** How many days of sales to ask sold-comps.com for (SOLD_LOOKBACK_DAYS). */
  soldLookbackDays?: number;
  /** Lookups left on sold-comps.com, when its answer says. */
  onSoldRemaining?: (left: number) => void;
}

/** Sold comparables: Marketplace Insights, else sold-comps.com whenever Insights fails and a key is set. */
async function searchSoldAny(
  client: EbayClient,
  q: ComparableQuery,
  opts: BothOptions,
): Promise<ComparableResult> {
  const marketplaceId = client.config.marketplaceId;
  try {
    const items = await searchSold(client, q);
    return { source: "marketplace_insights", marketplaceId, items, notes: [] };
  } catch (err) {
    // With a sold-comps.com key, any Insights failure falls back to it: the
    // sandbox answers the search itself with 400, not only 401/403.
    if (!opts.soldCompsApiKey) throw err;
  }
  const sc = {
    apiKey: opts.soldCompsApiKey,
    marketplaceId,
    fetch: opts.soldCompsFetch,
    lookbackDays: opts.soldLookbackDays,
    onRemaining: opts.onSoldRemaining,
  };
  const notes = ["Sold prices from sold-comps.com, a third-party service, not from eBay directly."];
  let items: Comparable[] = [];
  let matchedBy: ComparableResult["matchedBy"] = "keywords";
  // A barcode finds that exact pressing (the Canadian CD, not the vinyl or the
  // Japanese issue), like scanning in eBay's app. Only when it finds too few
  // sales is a second, by-name search spent (sold-comps.com quota is small).
  if (q.gtin) {
    items = await searchSoldComps(q, { ...sc, by: "barcode" });
    if (items.length >= MIN_BARCODE_MATCHES || !hasName(q)) {
      matchedBy = "barcode";
      notes.push(`Sales of this exact barcode (${q.gtin}), so the same pressing.`);
    } else {
      notes.push(`Only ${items.length} sales carry this barcode, so sales were found by name.`);
      items = await searchSoldComps(q, { ...sc, by: "keywords" });
    }
  } else {
    items = await searchSoldComps(q, sc);
  }
  const oldest = items.map((i) => i.soldDate).filter(Boolean).sort()[0];
  if (oldest) notes.push(`Oldest sale found: ${oldest}.`);
  return { source: "sold_comps", marketplaceId, items, notes, matchedBy };
}

/** Fewer barcode matches than this and the search falls back to the item name. */
export const MIN_BARCODE_MATCHES = 3;

/**
 * True when the query has a name to fall back to. When eBay and MusicBrainz
 * don't know a barcode, the item name is the barcode digits themselves:
 * searching "by name" would only repeat the barcode search (and spend a
 * second sold-comps.com call).
 */
export function hasName(q: ComparableQuery): boolean {
  const k = q.keywords?.trim();
  if (!k) return false;
  const digits = k.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || !q.gtin) return true;
  const bare = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  return bare(digits) !== bare(q.gtin);
}

/**
 * Runs the active-listing and sold searches side by side so the screen can
 * show a "current listings" price and a "last sold" price. One failing never
 * hides the other; throws only when both fail.
 */
export async function findBothComparables(
  client: EbayClient,
  q: ComparableQuery,
  opts: BothOptions = {},
): Promise<BothComparables> {
  const marketplaceId = client.config.marketplaceId;
  let soldRemaining: number | undefined;
  const [active, sold] = await Promise.allSettled([
    searchActiveAny(client, q),
    searchSoldAny(client, q, {
      ...opts,
      onSoldRemaining: (n) => {
        soldRemaining = soldRemaining === undefined ? n : Math.min(soldRemaining, n);
        opts.onSoldRemaining?.(n);
      },
    }),
  ]);
  const unavailable: BothComparables["unavailable"] = {};
  let soldLimitReached = false;
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let current: ComparableResult | null = null;
  if (active.status === "fulfilled") {
    current = { source: "browse_active", marketplaceId, ...active.value };
  } else {
    unavailable.current = `Current listings search failed: ${message(active.reason)}`;
  }

  let soldResult: ComparableResult | null = null;
  if (sold.status === "fulfilled") {
    soldResult = sold.value;
  } else {
    soldLimitReached = isSoldCompsLimit(sold.reason);
    unavailable.sold = soldLimitReached
      ? SOLD_LIMIT_NOTE
      : isAccessDenied(sold.reason)
        ? SOLD_ACCESS_NOTE
        : `Sold search failed: ${message(sold.reason)}`;
  }

  if (!current && !soldResult) {
    throw active.status === "rejected" ? active.reason : new Error(unavailable.sold);
  }
  return {
    current,
    sold: soldResult,
    unavailable,
    ...(soldLimitReached && { soldLimitReached }),
    ...(soldRemaining !== undefined && { soldRemaining }),
  };
}
