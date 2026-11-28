import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessToken } from "./lib/auth/access";
import { proxy } from "./proxy";

const call = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://app.example${path}`, { headers }));
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lets an API call through with the key header", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "s3cret-key");
    expect(passed(await call("/api/listing/refresh", { "x-elister-key": "s3cret-key" }))).toBe(true);
  });

  it("refuses a wrong or missing header with the locked message", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "s3cret-key");
    for (const headers of [{ "x-elister-key": "wrong" }, {} as Record<string, string>]) {
      const res = await call("/api/listing/refresh", headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "This app is locked. Open it and enter the access key." });
    }
  });

  it("does not open pages with the header", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "s3cret-key");
    const res = await call("/auto", { "x-elister-key": "s3cret-key" });
    expect(res.headers.get("location")).toBe("https://app.example/unlock?next=%2Fauto");
  });

  it("still accepts the phone's cookie", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "s3cret-key");
    const cookie = `el_access=${await accessToken("s3cret-key")}`;
    expect(passed(await call("/api/listing/refresh", { cookie }))).toBe(true);
  });

  it("refuses the key header where only the phone may act (starting, sending, dismissing batches)", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "s3cret-key");
    for (const path of ["/api/batch/run", "/api/batch/apply", "/api/batch/dismiss", "/api/batch/apply/"]) {
      const res = await call(path, { "x-elister-key": "s3cret-key" });
      expect(res.status, path).toBe(401);
    }
    const cookie = `el_access=${await accessToken("s3cret-key")}`;
    expect(passed(await call("/api/batch/apply", { cookie }))).toBe(true);
    for (const path of ["/api/batch/proposals", "/api/batch/runs/r1", "/api/batch"]) {
      expect(passed(await call(path, { "x-elister-key": "s3cret-key" })), path).toBe(true);
    }
  });

  it("stays open when no key is set", async () => {
    vi.stubEnv("APP_ACCESS_KEY", "");
    expect(passed(await call("/api/listing/refresh"))).toBe(true);
  });
});
