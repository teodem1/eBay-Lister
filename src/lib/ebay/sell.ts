// Small client for the eBay Sell Inventory, Taxonomy and OAuth APIs.
// TypeScript port of ebay_handler.py from teodem1/ebay-item-listings-anthropic-claude,
// with token minting, idempotent re-publish and category lookup added.
// `fetch` is injectable so tests can mock every eBay call.

import type { EbayConfig } from "./config";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class EbayApiError extends Error {
  constructor(
    public step: string,
    public status: number,
    public body: unknown,
  ) {
    super(`eBay ${step} failed (${status}): ${summarizeEbayErrors(body)}`);
    this.name = "EbayApiError";
  }
}

function summarizeEbayErrors(body: unknown): string {
  if (body && typeof body === "object" && "errors" in body && Array.isArray((body as { errors: unknown[] }).errors)) {
    return (body as { errors: { errorId?: number; message?: string; longMessage?: string }[] }).errors
      .map((e) => `${e.errorId ?? ""} ${e.longMessage || e.message || ""}`.trim())
      .join("; ");
  }
  if (body && typeof body === "object" && "error_description" in body) {
    return String((body as { error_description: unknown }).error_description);
  }
  return typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300) ?? "";
}

/** eBay condition enums accepted by the Inventory API. */
export const CONDITIONS = [
  "NEW",
  "LIKE_NEW",
  "NEW_OTHER",
  "NEW_WITH_DEFECTS",
  "CERTIFIED_REFURBISHED",
  "EXCELLENT_REFURBISHED",
  "VERY_GOOD_REFURBISHED",
  "GOOD_REFURBISHED",
  "SELLER_REFURBISHED",
  "USED_EXCELLENT",
  "USED_VERY_GOOD",
  "USED_GOOD",
  "USED_ACCEPTABLE",
  "FOR_PARTS_OR_NOT_WORKING",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface InventoryItemInput {
  sku: string;
  title: string;
  descriptionHtml: string;
  condition: Condition;
  conditionDescription?: string;
  aspects: Record<string, string[]>;
  imageUrls: string[];
  quantity: number;
  ean?: string[];
  upc?: string[];
  brand?: string;
  mpn?: string;
}

export interface OfferInput {
  sku: string;
  categoryId: string;
  price: number;
  quantity: number;
  descriptionHtml: string;
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  path: string;
}

const INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";
const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

export class EbaySellClient {
  private userToken?: { value: string; expiresAt: number };
  private appToken?: { value: string; expiresAt: number };

  constructor(
    private config: EbayConfig,
    private fetchImpl: FetchLike = fetch,
  ) {}

  // ---------- OAuth ----------

  private basicAuth(): string {
    const { clientId, clientSecret } = this.config;
    if (!clientId || !clientSecret) {
      throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set.");
    }
    return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  }

  private async mintToken(body: URLSearchParams): Promise<{ value: string; expiresAt: number }> {
    const res = await this.fetchImpl(`${this.config.apiBase}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: this.basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("oauth token", res.status, data);
    const { access_token, expires_in } = data as { access_token: string; expires_in: number };
    // Refresh a minute early.
    return { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  }

  /** User access token for the Sell APIs (acts on the seller's account). */
  async getUserToken(): Promise<string> {
    // The refresh token wins: a leftover 2-hour EBAY_USER_TOKEN (often from eBay's
    // developer page, without the sell.inventory scope) would otherwise shadow it.
    if (!this.config.refreshToken && this.config.userToken) return this.config.userToken;
    if (this.userToken && this.userToken.expiresAt > Date.now()) return this.userToken.value;
    if (!this.config.refreshToken) {
      throw new Error(
        "No eBay user token. Set EBAY_REFRESH_TOKEN (from the eBay OAuth consent flow) or EBAY_USER_TOKEN.",
      );
    }
    this.userToken = await this.mintToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        scope: INVENTORY_SCOPE,
      }),
    );
    return this.userToken.value;
  }

  /** Application token (client credentials) for public APIs like Taxonomy. */
  async getAppToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now()) return this.appToken.value;
    this.appToken = await this.mintToken(new URLSearchParams({ grant_type: "client_credentials", scope: APP_SCOPE }));
    return this.appToken.value;
  }

  private async sellRequest(step: string, method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.getUserToken();
    return this.fetchImpl(`${this.config.apiBase}/sell/inventory/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Language": this.config.contentLanguage,
        // Node's fetch sends "Accept-Language: *" by default, which the Inventory API
        // rejects (25709 Invalid value for header Accept-Language).
        "Accept-Language": this.config.contentLanguage,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // ---------- Inventory flow (same order as ebay_handler.py) ----------

  /** Creates the inventory location if it does not exist yet. Returns its key. */
  async ensureLocation(): Promise<string> {
    const { key, country, postalCode, city } = this.config.location;
    const path = `/location/${encodeURIComponent(key)}`;
    const check = await this.sellRequest("get location", "GET", path);
    if (check.ok) return key;
    if (check.status !== 404) throw new EbayApiError("get location", check.status, await readBody(check));

    const created = await this.sellRequest("create location", "POST", path, {
      location: { address: { country, postalCode, city } },
      locationTypes: ["WAREHOUSE"],
      name: "Default location",
      merchantLocationStatus: "ENABLED",
    });
    if (created.status !== 204 && !created.ok) {
      throw new EbayApiError("create location", created.status, await readBody(created));
    }
    return key;
  }

  /** Creates or replaces the inventory item for this SKU. */
  async putInventoryItem(item: InventoryItemInput): Promise<string> {
    const product: Record<string, unknown> = {
      title: item.title,
      description: item.descriptionHtml,
      aspects: item.aspects,
      imageUrls: item.imageUrls,
    };
    if (item.ean?.length) product.ean = item.ean;
    if (item.upc?.length) product.upc = item.upc;
    if (item.brand) product.brand = item.brand;
    if (item.mpn) product.mpn = item.mpn;

    const res = await this.sellRequest("create inventory item", "PUT", `/inventory_item/${encodeURIComponent(item.sku)}`, {
      availability: { shipToLocationAvailability: { quantity: item.quantity } },
      condition: item.condition,
      conditionDescription: item.conditionDescription || undefined,
      product,
    });
    if (res.status !== 201 && res.status !== 204 && !res.ok) {
      throw new EbayApiError("create inventory item", res.status, await readBody(res));
    }
    return item.sku;
  }

  private offerBody(offer: OfferInput, locationKey: string) {
    const c = this.config;
    return {
      sku: offer.sku,
      marketplaceId: c.marketplaceId,
      format: "FIXED_PRICE",
      availableQuantity: offer.quantity,
      categoryId: offer.categoryId,
      listingDescription: offer.descriptionHtml,
      listingPolicies: {
        fulfillmentPolicyId: c.fulfillmentPolicyId,
        paymentPolicyId: c.paymentPolicyId,
        returnPolicyId: c.returnPolicyId,
      },
      pricingSummary: { price: { value: offer.price.toFixed(2), currency: c.currency } },
      merchantLocationKey: locationKey,
    };
  }

  /** Finds an existing unpublished-or-published offer for the SKU on this marketplace. */
  async findOfferId(sku: string): Promise<string | undefined> {
    const qs = new URLSearchParams({ sku, marketplace_id: this.config.marketplaceId });
    const res = await this.sellRequest("get offers", "GET", `/offer?${qs}`);
    if (res.status === 404) return undefined;
    const data = await readBody(res);
    if (!res.ok) {
      // eBay answers 400 with errorId 25713 when the SKU has no offers.
      if (res.status === 400 && JSON.stringify(data).includes("25713")) return undefined;
      throw new EbayApiError("get offers", res.status, data);
    }
    return (data as { offers?: { offerId: string }[] }).offers?.[0]?.offerId;
  }

  /** Creates the offer, or updates it if one already exists for the SKU (so a retry doesn't fail). */
  async upsertOffer(offer: OfferInput, locationKey: string): Promise<string> {
    const body = this.offerBody(offer, locationKey);
    const existing = await this.findOfferId(offer.sku);
    if (existing) {
      const res = await this.sellRequest("update offer", "PUT", `/offer/${existing}`, body);
      if (!res.ok) throw new EbayApiError("update offer", res.status, await readBody(res));
      return existing;
    }
    const res = await this.sellRequest("create offer", "POST", "/offer", body);
    const data = await readBody(res);
    if (res.status !== 201 && !res.ok) throw new EbayApiError("create offer", res.status, data);
    const offerId = (data as { offerId?: string }).offerId;
    if (!offerId) throw new EbayApiError("create offer", res.status, "No offerId in response");
    return offerId;
  }

  /** Publishes the offer and returns the eBay listing ID. */
  async publishOffer(offerId: string): Promise<string> {
    const res = await this.sellRequest("publish offer", "POST", `/offer/${offerId}/publish`);
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("publish offer", res.status, data);
    const listingId = (data as { listingId?: string }).listingId;
    if (!listingId) throw new EbayApiError("publish offer", res.status, "No listingId in response");
    return listingId;
  }

  // ---------- Taxonomy (category + required item specifics) ----------

  private async taxonomyGet(step: string, path: string): Promise<unknown> {
    const token = await this.getAppToken();
    const res = await this.fetchImpl(`${this.config.apiBase}/commerce/taxonomy/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError(step, res.status, data);
    return data;
  }

  async getCategoryTreeId(): Promise<string> {
    const data = (await this.taxonomyGet(
      "get category tree",
      `/get_default_category_tree_id?marketplace_id=${this.config.marketplaceId}`,
    )) as { categoryTreeId: string };
    return data.categoryTreeId;
  }

  async suggestCategories(query: string, treeId?: string): Promise<CategorySuggestion[]> {
    const tree = treeId ?? (await this.getCategoryTreeId());
    const data = (await this.taxonomyGet(
      "category suggestions",
      `/category_tree/${tree}/get_category_suggestions?q=${encodeURIComponent(query)}`,
    )) as {
      categorySuggestions?: {
        category: { categoryId: string; categoryName: string };
        categoryTreeNodeAncestors?: { categoryName: string }[];
      }[];
    };
    return (data.categorySuggestions ?? []).slice(0, 5).map((s) => ({
      categoryId: s.category.categoryId,
      categoryName: s.category.categoryName,
      path: [...(s.categoryTreeNodeAncestors ?? []).map((a) => a.categoryName).reverse(), s.category.categoryName].join(
        " > ",
      ),
    }));
  }

  /** Item specifics eBay expects for a category, with the required ones first. */
  async getCategoryAspects(categoryId: string, treeId?: string): Promise<{ name: string; required: boolean }[]> {
    const tree = treeId ?? (await this.getCategoryTreeId());
    const data = (await this.taxonomyGet(
      "category aspects",
      `/category_tree/${tree}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    )) as { aspects?: { localizedAspectName: string; aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string } }[] };
    return (data.aspects ?? [])
      .filter((a) => a.aspectConstraint?.aspectRequired || a.aspectConstraint?.aspectUsage === "RECOMMENDED")
      .slice(0, 25)
      .map((a) => ({ name: a.localizedAspectName, required: Boolean(a.aspectConstraint?.aspectRequired) }));
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
