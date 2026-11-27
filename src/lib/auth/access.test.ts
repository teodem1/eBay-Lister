import { describe, expect, it } from "vitest";
import { accessToken, hasAccess, isPublicPath, safeNext, sameString } from "./access";

describe("app access key", () => {
  it("leaves the app open when no key is set", async () => {
    expect(await hasAccess(undefined, undefined)).toBe(true);
    expect(await hasAccess("", undefined)).toBe(true);
  });

  it("needs the cookie made from the key", async () => {
    const token = await accessToken("s3cret-key");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain("s3cret");
    expect(await hasAccess("s3cret-key", token)).toBe(true);
    expect(await hasAccess("s3cret-key", undefined)).toBe(false);
    expect(await hasAccess("s3cret-key", await accessToken("other"))).toBe(false);
    expect(await hasAccess("s3cret-key", "s3cret-key")).toBe(false);
  });

  it("compares strings fully", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
  });

  it("keeps the unlock page and page assets public, nothing else", () => {
    for (const p of ["/unlock", "/api/unlock", "/_next/static/x.js", "/icons/icon-192.png", "/sw.js", "/manifest.webmanifest"]) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ["/", "/auto", "/api/listing/publish", "/api/listing/revise", "/api/ebay/callback", "/api/unlock/x", "/unlocked"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("only returns to a path on this site", () => {
    expect(safeNext("/auto?x=1")).toBe("/auto?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
