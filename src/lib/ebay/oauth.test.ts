import { describe, expect, it, vi } from "vitest";
import { getEbayConfig } from "./config";
import { authorizeUrl, exchangeCode } from "./oauth";
import { EbayApiError, type FetchLike } from "./sell";

const prod = getEbayConfig({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret", EBAY_ENV: "production" });
const sandbox = getEbayConfig({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" });

describe("authorizeUrl", () => {
  it("sends the RuName as redirect_uri and asks for the seller scopes", () => {
    const url = new URL(authorizeUrl(prod, "My-RuName", "abc"));
    expect(url.origin).toBe("https://auth.ebay.com");
    expect(url.searchParams.get("redirect_uri")).toBe("My-RuName");
    expect(url.searchParams.get("client_id")).toBe("id");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("scope")).toContain("sell.inventory");
  });

  it("uses the sandbox sign-in for sandbox keys", () => {
    expect(authorizeUrl(sandbox, "r", "s")).toMatch(/^https:\/\/auth\.sandbox\.ebay\.com\//);
  });
});

describe("exchangeCode", () => {
  it("posts the code and returns the refresh token", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      Response.json({ access_token: "a", refresh_token: "v^1.1#r", refresh_token_expires_in: 47304000 }),
    );
    const res = await exchangeCode(prod, "My-RuName", "code 1", fetchMock);

    expect(res).toEqual({ refreshToken: "v^1.1#r", refreshTokenExpiresIn: 47304000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code 1");
    expect(body.get("redirect_uri")).toBe("My-RuName");
  });

  it("throws an EbayApiError when eBay refuses the code", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(exchangeCode(prod, "r", "old", fetchMock)).rejects.toBeInstanceOf(EbayApiError);
  });
});
