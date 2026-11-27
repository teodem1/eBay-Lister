// Small client for the eBay Sell Inventory, Taxonomy and OAuth APIs.
// TypeScript port of ebay_handler.py from teodem1/ebay-item-listings-anthropic-claude,
// with token minting, idempotent re-publish and category lookup added.
// `fetch` is injectable so tests can mock every eBay call.

import type { EbayConfig } from "./config";
import { CONDITION_IDS, type Condition } from "./conditions";

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

export { CONDITIONS, CONDITION_IDS, nearestAllowedCondition, type Condition } from "./conditions";
const CONDITION_BY_ID = Object.fromEntries(Object.entries(CONDITION_IDS).map(([k, v]) => [v, k as Condition]));

/** Box weight and size, needed when the shipping policy uses calculated shipping. */
export interface PackageInput {
  weightKg?: number;
  dimensionsCm?: { length: number; width: number; height: number };
}

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
  package?: PackageInput;
}

export interface OfferInput {
  sku: string;
  categoryId: string;
  price: number;
  quantity: number;
  descriptionHtml: string;
  /** Best Offer: offers under this % of the price are declined automatically. Unset or 0 = no Best Offer. */
  bestOfferMinPercent?: number;
}

export interface AspectHint {
  name: string;
  required: boolean;
  /** eBay's suggested values (dropdown), when it has some. */
  values?: string[];
  /** eBay only accepts one of the listed values. */
  selectionOnly?: boolean;
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  path: string;
}

const INVENTORY_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";
const MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing";
const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

/** The Media API lives on apim.ebay.com (apim.sandbox.ebay.com in the sandbox). */
export function mediaBase(apiBase: string): string {
  return apiBase.replace("://api.", "://apim.");
}

export class EbaySellClient {
  private userTokens = new Map<string, { value: string; expiresAt: number }>();
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

  /** User access token for the Sell APIs (acts on the seller's account), minted per scope. */
  async getUserToken(scope: string = INVENTORY_SCOPE): Promise<string> {
    // The refresh token wins: a leftover 2-hour EBAY_USER_TOKEN (often from eBay's
    // developer page, without the sell.inventory scope) would otherwise shadow it.
    if (!this.config.refreshToken && this.config.userToken) return this.config.userToken;
    const cached = this.userTokens.get(scope);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!this.config.refreshToken) {
      throw new Error(
        "No eBay user token. Set EBAY_REFRESH_TOKEN (from the eBay OAuth consent flow) or EBAY_USER_TOKEN.",
      );
    }
    const token = await this.mintToken(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.config.refreshToken, scope }),
    );
    this.userTokens.set(scope, token);
    return token.value;
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

  // ---------- Photos (Media API) ----------

  /**
   * Uploads a photo to eBay Picture Services and returns its https URL for
   * imageUrls. Media API: create_image_from_file answers 201 with a Location
   * header; reading that image gives imageUrl. An image not used in a listing expires.
   */
  async uploadImage(file: Blob, filename = "photo.jpg"): Promise<string> {
    const token = await this.getUserToken();
    const base = mediaBase(this.config.apiBase);
    const form = new FormData();
    form.append("image", file, filename);
    const res = await this.fetchImpl(`${base}/commerce/media/v1_beta/image/create_image_from_file`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: form,
    });
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("upload photo", res.status, data);
    const direct = (data as { imageUrl?: string } | null)?.imageUrl;
    if (direct) return direct;
    const location = res.headers.get("location");
    if (!location) throw new Error("eBay accepted the photo but returned no link to it.");
    const got = await this.fetchImpl(location, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const image = await readBody(got);
    if (!got.ok) throw new EbayApiError("get photo", got.status, image);
    const url = (image as { imageUrl?: string } | null)?.imageUrl;
    if (!url) throw new Error("eBay returned no URL for the uploaded photo.");
    return url;
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
      packageWeightAndSize: packageWeightAndSize(item.package),
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
        bestOfferTerms: bestOfferTerms(offer.price, offer.bestOfferMinPercent, c.currency),
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

  // ---------- Small edits to a live listing (Collection) ----------

  /** The inventory item for a SKU as eBay stores it, or undefined when there is none. */
  async getInventoryItemRaw(sku: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.sellRequest("get inventory item", "GET", `/inventory_item/${encodeURIComponent(sku)}`);
    if (res.status === 404) return undefined;
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("get inventory item", res.status, data);
    return data as Record<string, unknown>;
  }

  /** Replaces the inventory item with a body read by getInventoryItemRaw (and edited). Revises a live listing. */
  async putInventoryItemRaw(sku: string, item: Record<string, unknown>): Promise<void> {
    // Read-only fields eBay returns but does not take back.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sku: _sku, groupIds: _g, inventoryItemGroupKeys: _k, ...body } = item;
    const res = await this.sellRequest("update inventory item", "PUT", `/inventory_item/${encodeURIComponent(sku)}`, body);
    if (res.status !== 201 && res.status !== 204 && !res.ok) {
      throw new EbayApiError("update inventory item", res.status, await readBody(res));
    }
  }

  /** The SKU's offers on this marketplace (empty when it has none). */
  async getOffersRaw(sku: string): Promise<Record<string, unknown>[]> {
    const qs = new URLSearchParams({ sku, marketplace_id: this.config.marketplaceId });
    const res = await this.sellRequest("get offers", "GET", `/offer?${qs}`);
    if (res.status === 404) return [];
    const data = await readBody(res);
    if (!res.ok) {
      if (res.status === 400 && JSON.stringify(data).includes("25713")) return [];
      throw new EbayApiError("get offers", res.status, data);
    }
    return ((data as { offers?: Record<string, unknown>[] }).offers ?? []);
  }

  /** Replaces an offer with a body read by getOffersRaw (and edited). Revises a live listing. */
  async putOfferRaw(offer: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { offerId, status: _s, listing: _l, ...body } = offer;
    const res = await this.sellRequest("update offer", "PUT", `/offer/${encodeURIComponent(String(offerId))}`, body);
    if (!res.ok) throw new EbayApiError("update offer", res.status, await readBody(res));
  }

  /** One page of the seller's inventory items, as eBay stores them, with the total count. */
  async listInventoryItems(offset = 0, limit = 100): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const res = await this.sellRequest("list inventory items", "GET", `/inventory_item?limit=${limit}&offset=${offset}`);
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("list inventory items", res.status, data);
    const d = data as { inventoryItems?: Record<string, unknown>[]; total?: number };
    return { items: d.inventoryItems ?? [], total: d.total ?? d.inventoryItems?.length ?? 0 };
  }

  /** SKUs that start with a prefix (e.g. "BC-0602547…-"), newest pages first scanned up to `max` items. */
  async findSkus(prefix: string, max = 1000): Promise<string[]> {
    const found: string[] = [];
    for (let offset = 0; offset < max; offset += 200) {
      const res = await this.sellRequest("list inventory items", "GET", `/inventory_item?limit=200&offset=${offset}`);
      const data = await readBody(res);
      if (!res.ok) throw new EbayApiError("list inventory items", res.status, data);
      const items = (data as { inventoryItems?: { sku: string }[] }).inventoryItems ?? [];
      for (const i of items) if (i.sku?.toUpperCase().startsWith(prefix.toUpperCase())) found.push(i.sku);
      if (items.length < 200) break;
    }
    return found;
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

  // ---------- Marketing (Promoted Listings Standard, cost per sale) ----------

  private async marketingRequest(method: string, path: string, body?: unknown): Promise<Response> {
    let token: string;
    try {
      token = await this.getUserToken(MARKETING_SCOPE);
    } catch (err) {
      if (err instanceof EbayApiError && JSON.stringify(err.body).includes("invalid_scope")) {
        throw new Error(
          "The eBay refresh token has no marketing permission. Sign in again at /api/ebay/connect and replace EBAY_REFRESH_TOKEN.",
        );
      }
      throw err;
    }
    return this.fetchImpl(`${this.config.apiBase}/sell/marketing/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Language": this.config.contentLanguage,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Finds this app's running cost-per-sale campaign for the ad rate, creating it if needed. */
  async ensurePromotedCampaign(percent: number): Promise<string> {
    const name = promotedCampaignName(percent);
    const qs = new URLSearchParams({ campaign_name: name, limit: "10" });
    const found = await this.marketingRequest("GET", `/ad_campaign?${qs}`);
    const data = await readBody(found);
    if (!found.ok && found.status !== 404) throw new EbayApiError("find promoted campaign", found.status, data);
    const existing = ((data as { campaigns?: { campaignId: string; campaignName: string; campaignStatus: string; marketplaceId: string }[] })
      .campaigns ?? []).find(
      (c) =>
        c.campaignName === name &&
        c.marketplaceId === this.config.marketplaceId &&
        ["RUNNING", "SCHEDULED", "PAUSED"].includes(c.campaignStatus),
    );
    if (existing) return existing.campaignId;

    const created = await this.marketingRequest("POST", "/ad_campaign", {
      campaignName: name,
      marketplaceId: this.config.marketplaceId,
      startDate: new Date().toISOString(),
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: percent.toFixed(1) },
    });
    if (!created.ok) throw new EbayApiError("create promoted campaign", created.status, await readBody(created));
    const id = created.headers.get("location")?.split("/").pop();
    if (!id) throw new EbayApiError("create promoted campaign", created.status, "No campaign ID in response");
    return id;
  }

  /** Adds a live listing to the promoted campaign at the given ad rate (percent of the sale). */
  async promoteListing(listingId: string, percent: number): Promise<{ campaignId: string }> {
    const campaignId = await this.ensurePromotedCampaign(percent);
    const res = await this.marketingRequest("POST", `/ad_campaign/${campaignId}/ad`, {
      listingId,
      bidPercentage: percent.toFixed(1),
    });
    if (!res.ok) {
      const body = await readBody(res);
      // 35036: the listing is already in this campaign (e.g. a re-publish).
      if (!JSON.stringify(body).includes("35036")) throw new EbayApiError("promote listing", res.status, body);
    }
    return { campaignId };
  }

  // ---------- Metadata (which conditions a category accepts) ----------

  /**
   * Conditions each category accepts, keyed by category ID. A category missing from the
   * result has no condition policy on eBay (any condition is fine).
   */
  async getCategoryConditions(categoryIds: string[]): Promise<Record<string, Condition[]>> {
    const ids = categoryIds.filter((id) => /^\d+$/.test(id));
    if (!ids.length) return {};
    const token = await this.getAppToken();
    const qs = new URLSearchParams({ filter: `categoryIds:{${ids.join("|")}}` });
    const res = await this.fetchImpl(
      `${this.config.apiBase}/sell/metadata/v1/marketplace/${this.config.marketplaceId}/get_item_condition_policies?${qs}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Language": this.config.contentLanguage } },
    );
    const data = await readBody(res);
    if (!res.ok) throw new EbayApiError("condition policies", res.status, data);
    const out: Record<string, Condition[]> = {};
    for (const p of (data as { itemConditionPolicies?: { categoryId: string; itemConditions?: { conditionId: string }[] }[] })
      .itemConditionPolicies ?? []) {
      const conditions = (p.itemConditions ?? []).map((c) => CONDITION_BY_ID[c.conditionId]).filter(Boolean);
      if (conditions.length) out[p.categoryId] = conditions;
    }
    return out;
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

  /**
   * Item specifics for a category: required first, then recommended, then optional
   * (buyers filter on optional ones too). Each carries eBay's suggested values, so
   * Claude can use the exact dropdown value that eBay's filters match.
   */
  async getCategoryAspects(categoryId: string, treeId?: string): Promise<AspectHint[]> {
    const tree = treeId ?? (await this.getCategoryTreeId());
    const data = (await this.taxonomyGet(
      "category aspects",
      `/category_tree/${tree}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    )) as {
      aspects?: {
        localizedAspectName: string;
        aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string; aspectMode?: string };
        aspectValues?: { localizedValue: string }[];
      }[];
    };
    const rank = (a: { aspectConstraint?: { aspectRequired?: boolean; aspectUsage?: string } }) =>
      a.aspectConstraint?.aspectRequired ? 0 : a.aspectConstraint?.aspectUsage === "RECOMMENDED" ? 1 : 2;
    return [...(data.aspects ?? [])]
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 40)
      .map((a) => {
        const values = (a.aspectValues ?? []).map((v) => v.localizedValue).filter(Boolean);
        const hint: AspectHint = { name: a.localizedAspectName, required: Boolean(a.aspectConstraint?.aspectRequired) };
        if (a.aspectConstraint?.aspectMode === "SELECTION_ONLY") hint.selectionOnly = true;
        // Long lists (genres, years) are cut: Claude knows the common ones, the first few show the style.
        if (values.length) hint.values = values.slice(0, 30);
        return hint;
      });
  }
}

/**
 * Best Offer with no auto-accept: every offer waits for the seller, except offers
 * under `minPercent`% of the price, which eBay declines automatically
 * (e.g. 70 on $10.00 declines anything under $7.00).
 */
export function bestOfferTerms(price: number, minPercent: number | undefined, currency: string) {
  if (!minPercent || minPercent <= 0 || minPercent >= 100) return undefined;
  // Rounded first so float noise (22 x 70% = 15.3999...) doesn't take off a cent.
  const decline = Math.floor(Math.round(price * minPercent * 1000) / 1000) / 100;
  return {
    bestOfferEnabled: true,
    autoDeclinePrice: { value: decline.toFixed(2), currency },
  };
}

export function promotedCampaignName(percent: number): string {
  return `eBay Lister - Standard ${percent.toFixed(1)}%`;
}

function packageWeightAndSize(pkg?: PackageInput) {
  if (!pkg) return undefined;
  const out: Record<string, unknown> = {};
  if (pkg.weightKg && pkg.weightKg > 0) out.weight = { value: pkg.weightKg, unit: "KILOGRAM" };
  const d = pkg.dimensionsCm;
  if (d && d.length > 0 && d.width > 0 && d.height > 0) out.dimensions = { ...d, unit: "CENTIMETER" };
  return Object.keys(out).length ? out : undefined;
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
