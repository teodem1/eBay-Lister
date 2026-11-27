import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeErrorMessage } from "./errors";

const apiError = (status: number, body: object) =>
  Anthropic.APIError.generate(status, body, undefined, new Headers());

describe("claudeErrorMessage", () => {
  it("says out of credits for the low credit balance error", () => {
    const err = apiError(400, {
      type: "error",
      error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
    });
    expect(claudeErrorMessage(err)).toMatch(/^Out of Claude API credits/);
  });

  it("says out of credits for a billing error", () => {
    expect(claudeErrorMessage(apiError(402, { type: "error", error: { type: "billing_error", message: "x" } }))).toMatch(
      /^Out of Claude API credits/,
    );
  });

  it("never shows the raw JSON body", () => {
    const msg = claudeErrorMessage(apiError(400, { type: "error", error: { type: "invalid_request_error", message: "bad" } }));
    expect(msg).toBe("Claude API error (400).");
  });

  it("leaves other errors alone", () => {
    expect(claudeErrorMessage(new Error("eBay down"))).toBeUndefined();
  });
});
