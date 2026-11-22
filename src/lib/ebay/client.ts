/**
 * Thin eBay REST client. All network access to eBay goes through here so it
 * can be swapped for a fake `fetch` in tests. Server-side only: it uses the
 * client secret.
 */
import { apiBaseUrl, type EbayConfig } from "./config";

export type FetchLike = typeof fetch;

/** Application-token scope. Covers the Browse API. */
export const SCOPE_PUBLIC = "https://api.ebay.com/oauth/api_scope";
/**
 * Scope for the Marketplace Insights API. eBay only grants it to approved
 * apps; a normal keyset gets `invalid_scope` when requesting it.
 */
export const SCOPE_MARKETPLACE_INSIGHTS =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export class EbayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "EbayApiError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class EbayClient {
  private tokens = new Map<string, CachedToken>();

  constructor(
    readonly config: EbayConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Client-credentials (application) token for the given scope, cached. */
  async getAppToken(scope: string): Promise<string> {
    const cached = this.tokens.get(scope);
    if (cached && cached.expiresAt > this.now() + 60_000) return cached.token;

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
    const body = await readJson(res);
    if (!res.ok) {
      throw new EbayApiError(
        `eBay token request failed (${res.status})`,
        res.status,
        body,
      );
    }
    const { access_token, expires_in } = body as {
      access_token: string;
      expires_in: number;
    };
    this.tokens.set(scope, {
      token: access_token,
      expiresAt: this.now() + expires_in * 1000,
    });
    return access_token;
  }

  /** GET a Buy API path with an app token and marketplace/end-user headers. */
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
    const body = await readJson(res);
    if (!res.ok) {
      throw new EbayApiError(
        `eBay GET ${path} failed (${res.status})`,
        res.status,
        body,
      );
    }
    return body as T;
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
