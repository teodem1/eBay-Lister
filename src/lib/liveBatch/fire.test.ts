import { describe, expect, it, vi } from "vitest";
import { fireRoutine } from "./fire";

const env = { ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_X/fire", ROUTINE_FIRE_TOKEN: "sk-secret-token" };

describe("fireRoutine", () => {
  it("fires the task with the token, the beta headers and the text", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "s1", claude_code_session_url: "https://claude.ai/code/session_1" }),
    );
    const out = await fireRoutine(env, '{"runId":"r1"}', fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ sessionId: "s1", sessionUrl: "https://claude.ai/code/session_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.ROUTINE_FIRE_URL);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-secret-token");
    expect(headers.get("anthropic-beta")).toBe("experimental-cc-routine-2026-04-01");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init.body))).toEqual({ text: '{"runId":"r1"}' });
  });

  it("says batch runs are not set up when the settings are missing", async () => {
    await expect(fireRoutine({}, "x", vi.fn() as unknown as typeof fetch)).rejects.toThrow(
      "Batch runs are not set up (ROUTINE_FIRE_URL, ROUTINE_FIRE_TOKEN).",
    );
  });

  it("names only the status when the fire fails, never the token or the body", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad token sk-secret-token", { status: 500 }));
    const err = await fireRoutine(env, "x", fetchImpl as unknown as typeof fetch).catch((e: Error) => e);
    expect((err as Error).message).toBe("The batch could not start (status 500).");
    expect((err as Error).message).not.toContain("sk-secret-token");
  });
});
