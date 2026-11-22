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
    q: q.gtin || q.epid ? undefined : q.keywords,
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
}

export const SOLD_ACCESS_NOTE =
  "eBay only gives sold prices to apps it approves for its Marketplace Insights API, and this app is not approved.";

/**
 * Runs the active-listing and sold searches side by side so the screen can
 * show a "current listings" price and a "last sold" price. One failing never
 * hides the other; throws only when both fail.
 */
export async function findBothComparables(
  client: EbayClient,
  q: ComparableQuery,
): Promise<BothComparables> {
  const marketplaceId = client.config.marketplaceId;
  const [active, sold] = await Promise.allSettled([searchActive(client, q), searchSold(client, q)]);
  const unavailable: BothComparables["unavailable"] = {};
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  let current: ComparableResult | null = null;
  if (active.status === "fulfilled") {
    current = { source: "browse_active", marketplaceId, items: active.value, notes: [] };
  } else {
    unavailable.current = `Current listings search failed: ${message(active.reason)}`;
  }

  let soldResult: ComparableResult | null = null;
  if (sold.status === "fulfilled") {
    soldResult = { source: "marketplace_insights", marketplaceId, items: sold.value, notes: [] };
  } else {
    unavailable.sold = isAccessDenied(sold.reason)
      ? SOLD_ACCESS_NOTE
      : `Sold search failed: ${message(sold.reason)}`;
  }

  if (!current && !soldResult) {
    throw active.status === "rejected" ? active.reason : new Error(unavailable.sold);
  }
  return { current, sold: soldResult, unavailable };
}
