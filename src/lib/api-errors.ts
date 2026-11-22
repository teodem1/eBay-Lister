import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { EbayApiError, EbayConfigError } from "./ebay";

/** Turns a thrown error into a JSON response with a message the phone UI can show. */
export function errorResponse(err: unknown): Response {
  console.error(err);
  if (err instanceof EbayConfigError) {
    return Response.json({ error: err.message }, { status: 500 });
  }
  if (err instanceof EbayApiError) {
    const msg =
      err.status === 401
        ? "eBay rejected the app keys. Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET and EBAY_ENV."
        : `eBay returned an error (${err.status}).`;
    return Response.json({ error: msg }, { status: 502 });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return Response.json({ error: "Claude API key missing or invalid (ANTHROPIC_API_KEY)." }, { status: 500 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Claude is busy, try again in a few seconds." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    return Response.json({ error: `Claude API error (${err.status}).` }, { status: 502 });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}
