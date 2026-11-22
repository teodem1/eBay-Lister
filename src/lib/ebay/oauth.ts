// One-time eBay sign-in that produces the long-lived refresh token for EBAY_REFRESH_TOKEN.
// eBay's developer page only hands out 2-hour user tokens; the refresh token comes
// from the authorization-code grant, which these helpers run.
import type { EbayConfig } from "./config";
import { EbayApiError, type FetchLike } from "./sell";

/** Scopes the app's seller features need. */
export const SELLER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

export function authorizeUrl(config: EbayConfig, ruName: string, state: string): string {
  const host = config.env === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
  const params = new URLSearchParams({
    client_id: config.clientId ?? "",
    redirect_uri: ruName, // eBay wants the RuName here, not a URL
    response_type: "code",
    scope: SELLER_SCOPES.join(" "),
    state,
    prompt: "login",
  });
  return `${host}/oauth2/authorize?${params}`;
}

export interface RefreshTokenResult {
  refreshToken: string;
  /** Seconds until the refresh token expires (about 18 months). */
  refreshTokenExpiresIn: number;
}

/** Trades the one-time code from eBay's redirect for a refresh token. */
export async function exchangeCode(
  config: EbayConfig,
  ruName: string,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<RefreshTokenResult> {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set.");
  const res = await fetchImpl(`${config.apiBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ruName }).toString(),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new EbayApiError("oauth code exchange", res.status, data);
  const { refresh_token, refresh_token_expires_in } = data as {
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
  if (!refresh_token) throw new Error("eBay did not return a refresh token.");
  return { refreshToken: refresh_token, refreshTokenExpiresIn: refresh_token_expires_in ?? 0 };
}
