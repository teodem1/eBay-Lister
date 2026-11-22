import { describe, expect, it } from "vitest";
import { getEbayConfig } from "./config";
import { EbaySellClient, mediaBase, type FetchLike } from "./sell";

const config = getEbayConfig({
  EBAY_ENV: "production",
  EBAY_CLIENT_ID: "id",
  EBAY_CLIENT_SECRET: "secret",
  EBAY_REFRESH_TOKEN: "refresh",
});

function fake(answers: Record<string, () => Response>) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const u = new URL(url);
    const key = `${init?.method ?? "GET"} ${u.host}${u.pathname}`;
    const answer = answers[key];
    if (!answer) throw new Error(`unexpected ${key}`);
    return answer();
  };
  return { fetchImpl, calls };
}

const token = () => Response.json({ access_token: "T", expires_in: 7200 });

describe("uploadImage", () => {
  it("uploads to the Media API and follows Location to the image URL", async () => {
    const { fetchImpl, calls } = fake({
      "POST api.ebay.com/identity/v1/oauth2/token": token,
      "POST apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file": () =>
        new Response(null, { status: 201, headers: { Location: "https://apim.ebay.com/commerce/media/v1_beta/image/IMG1" } }),
      "GET apim.ebay.com/commerce/media/v1_beta/image/IMG1": () =>
        Response.json({ imageUrl: "https://i.ebayimg.com/images/g/abc/s-l1600.jpg", expirationDate: "2027-01-01" }),
    });
    const url = await new EbaySellClient(config, fetchImpl).uploadImage(new Blob(["x"], { type: "image/jpeg" }), "cd.jpg");
    expect(url).toBe("https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
    const upload = calls[1];
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it("reports eBay's error", async () => {
    const { fetchImpl } = fake({
      "POST api.ebay.com/identity/v1/oauth2/token": token,
      "POST apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file": () =>
        Response.json({ errors: [{ errorId: 190000, message: "Invalid image" }] }, { status: 400 }),
    });
    await expect(new EbaySellClient(config, fetchImpl).uploadImage(new Blob(["x"]))).rejects.toThrow(/upload photo/);
  });
});

describe("mediaBase", () => {
  it("uses the apim host", () => {
    expect(mediaBase("https://api.ebay.com")).toBe("https://apim.ebay.com");
    expect(mediaBase("https://api.sandbox.ebay.com")).toBe("https://apim.sandbox.ebay.com");
  });
});
