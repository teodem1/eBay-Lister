import { describe, expect, it, vi } from "vitest";
import { EbayApiError, EbayClient, REFUSED_SCOPE_TTL_MS } from "./client";
import { readEbayConfig, EbayConfigError } from "./config";

const config = { clientId: "id", clientSecret: "secret", env: "sandbox" as const, marketplaceId: "EBAY_FR" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/identity/v1/oauth2/token")) {
      return jsonResponse({ access_token: "tok", expires_in: 7200 });
    }
    return jsonResponse({
      total: 1,
      itemSummaries: [
        {
          itemId: "v1|1|0",
          title: "Nintendo Switch OLED",
          price: { value: "249.00", currency: "EUR" },
          image: { imageUrl: "https://i.ebayimg.com/x.jpg" },
          itemLocation: { country: "FR" },
          shippingOptions: [{ shippingCost: { value: "0.00", currency: "EUR" } }],
        },
      ],
    });
  });
}

describe("EbayClient", () => {
  it("remembers a refused scope for an hour instead of asking eBay on every price check", async () => {
    let now = 1_000_000;
    const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid_scope" }, 400));
    const client = new EbayClient(config, fetchMock as unknown as typeof fetch, () => now);
    const scope = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

    await expect(client.getAppToken(scope)).rejects.toBeInstanceOf(EbayApiError);
    const second = await client.getAppToken(scope).catch((e: EbayApiError) => e);
    expect(second).toBeInstanceOf(EbayApiError);
    expect((second as EbayApiError).body).toContain("invalid_scope");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += REFUSED_SCOPE_TTL_MS + 1;
    await expect(client.getAppToken(scope)).rejects.toBeInstanceOf(EbayApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not remember other token failures", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "server_error" }, 500));
    const client = new EbayClient(config, fetchMock as unknown as typeof fetch);
    await expect(client.getAppToken()).rejects.toBeInstanceOf(EbayApiError);
    await expect(client.getAppToken()).rejects.toBeInstanceOf(EbayApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gets a token, then searches by barcode on the sandbox host", async () => {
    const fetchMock = fakeFetch();
    const client = new EbayClient(config, fetchMock as unknown as typeof fetch);

    const result = await client.searchItems({ gtin: "0045496453435" });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );

    const [searchUrl, searchInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(searchUrl).toContain("/buy/browse/v1/item_summary/search?gtin=0045496453435");
    expect((searchInit.headers as Record<string, string>)["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_FR");

    expect(result.items[0]).toMatchObject({
      title: "Nintendo Switch OLED",
      price: { value: "249.00", currency: "EUR" },
      shippingCost: { value: "0.00", currency: "EUR" },
      itemCountry: "FR",
      imageUrl: "https://i.ebayimg.com/x.jpg",
    });
  });

  it("reuses the token until it nears expiry", async () => {
    const fetchMock = fakeFetch();
    let now = 0;
    const client = new EbayClient(config, fetchMock as unknown as typeof fetch, () => now);
    await client.searchItems({ q: "a" });
    await client.searchItems({ q: "b" });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 token + 2 searches

    now = 7200 * 1000; // token expired
    await client.searchItems({ q: "c" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("throws EbayApiError with the status on failure", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = new EbayClient(config, fetchMock as unknown as typeof fetch);
    await expect(client.searchItems({ q: "x" })).rejects.toMatchObject({
      name: "EbayApiError",
      status: 401,
    });
    await expect(client.searchItems({ q: "x" })).rejects.toBeInstanceOf(EbayApiError);
  });
});

describe("readEbayConfig", () => {
  it("requires keys", () => {
    expect(() => readEbayConfig({} as NodeJS.ProcessEnv)).toThrow(EbayConfigError);
  });

  it("defaults to sandbox and EBAY_CA", () => {
    expect(
      readEbayConfig({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b" } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ clientId: "a", clientSecret: "b", env: "sandbox", marketplaceId: "EBAY_CA" });
  });
});
