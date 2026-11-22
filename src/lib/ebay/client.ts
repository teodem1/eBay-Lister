/**
 * Small eBay client. All eBay HTTP calls go through here so tests can pass
 * a fake `fetch`. Uses an application token (client credentials grant),
 * which is enough for the Browse API's public search.
 */
import { apiBaseUrl, type EbayConfig } from "./config";

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

/** Application-token scope. Covers the Browse API. */
export const SCOPE_PUBLIC = BROWSE_SCOPE;
/**
 * Scope for the Marketplace Insights API (sold items). eBay only grants it
 * to approved apps; a normal keyset gets `invalid_scope` when requesting it.
 */
export const SCOPE_MARKETPLACE_INSIGHTS =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export interface ItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  shippingCost?: { value: string; currency: string };
  condition?: string;
  imageUrl?: string;
  itemWebUrl?: string;
  epid?: string;
  /** Country the item ships from, e.g. "FR". */
  itemCountry?: string;
}

export interface SearchParams {
  /** Barcode (UPC / EAN / ISBN). */
  gtin?: string;
  /** Free-text keywords. */
  q?: string;
  limit?: number;
}

export interface SearchResult {
  total: number;
  items: ItemSummary[];
}

export type FetchLike = typeof fetch;

export class EbayApiError extends Error {
  name = "EbayApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class EbayClient {
  private tokens = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    readonly config: EbayConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns a cached application access token, fetching a new one when it is about to expire. */
  async getAppToken(scope: string = BROWSE_SCOPE): Promise<string> {
    const cached = this.tokens.get(scope);
    if (cached && cached.expiresAt - 60_000 > this.now()) {
      return cached.value;
    }
    const basic = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64");
    const res = await this.fetchImpl(
      `${apiBaseUrl(this.config.env)}/identity/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope,
        }).toString(),
      },
    );
    if (!res.ok) {
      throw new EbayApiError("eBay token request failed", res.status, await res.text());
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens.set(scope, {
      value: json.access_token,
      expiresAt: this.now() + json.expires_in * 1000,
    });
    return json.access_token;
  }

  /** GET a Buy API path with an app token for `scope`, plus marketplace/end-user headers. */
  async get<T>(
    path: string,
    params: Record<string, string | undefined>,
    opts: { scope: string; endUserCtx?: string },
  ): Promise<T> {
    const token = await this.getAppToken(opts.scope);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": this.config.marketplaceId,
      Accept: "application/json",
    };
    if (opts.endUserCtx) headers["X-EBAY-C-ENDUSERCTX"] = opts.endUserCtx;

    const res = await this.fetchImpl(
      `${apiBaseUrl(this.config.env)}${path}?${qs.toString()}`,
      { headers },
    );
    if (!res.ok) {
      throw new EbayApiError(`eBay GET ${path} failed (${res.status})`, res.status, await res.text());
    }
    return (await res.json()) as T;
  }

  /** Browse API item search, by barcode (gtin) and/or keywords (q). */
  async searchItems(params: SearchParams): Promise<SearchResult> {
    if (!params.gtin && !params.q) {
      throw new Error("searchItems needs a gtin or a q");
    }
    const token = await this.getAppToken();
    const query = new URLSearchParams();
    if (params.gtin) query.set("gtin", params.gtin);
    if (params.q) query.set("q", params.q);
    query.set("limit", String(params.limit ?? 10));

    const res = await this.fetchImpl(
      `${apiBaseUrl(this.config.env)}/buy/browse/v1/item_summary/search?${query}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": this.config.marketplaceId,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new EbayApiError("eBay search failed", res.status, await res.text());
    }
    return toSearchResult(await res.json());
  }
}

interface RawItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  itemWebUrl?: string;
  epid?: string;
  itemLocation?: { country?: string };
  shippingOptions?: { shippingCost?: { value: string; currency: string } }[];
}

export function toSearchResult(raw: unknown): SearchResult {
  const data = (raw ?? {}) as { total?: number; itemSummaries?: RawItemSummary[] };
  const items = (data.itemSummaries ?? []).map(
    (s): ItemSummary => ({
      itemId: s.itemId,
      title: s.title,
      price: s.price,
      shippingCost: s.shippingOptions?.[0]?.shippingCost,
      condition: s.condition,
      imageUrl: s.image?.imageUrl ?? s.thumbnailImages?.[0]?.imageUrl,
      itemWebUrl: s.itemWebUrl,
      epid: s.epid,
      itemCountry: s.itemLocation?.country,
    }),
  );
  return { total: data.total ?? items.length, items };
}
