// Short, readable messages for Claude API errors, instead of the raw JSON body the SDK puts in err.message.
import Anthropic from "@anthropic-ai/sdk";

/** A message the phone can show for a Claude API error, or undefined when err is not one. */
export function claudeErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof Anthropic.APIError)) return undefined;
  const text = `${err.type ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (err.status === 402 || text.includes("billing_error") || text.includes("credit balance")) {
    return "Out of Claude API credits. Add credits at console.anthropic.com, then try again.";
  }
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key missing or invalid (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.PermissionDeniedError) return "This Claude API key is not allowed to do that.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited. Try again in a minute.";
  if (err.status === 529 || text.includes("overloaded")) return "Claude is overloaded right now. Try again in a minute.";
  if (err.status !== undefined && err.status >= 500) return `Claude had a server error (${err.status}). Try again.`;
  return `Claude API error${err.status ? ` (${err.status})` : ""}.`;
}

/** HTTP status to send back for a Claude API error. */
export function claudeErrorStatus(err: InstanceType<typeof Anthropic.APIError>): number {
  if (err.status === 429) return 429;
  return 502;
}
