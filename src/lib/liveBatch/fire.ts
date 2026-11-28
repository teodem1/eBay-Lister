/**
 * Starts a Claude Code cloud session by firing the seller's scheduled task through its
 * API trigger (Claude Code docs, "routines": POST .../routines/<trigger-id>/fire). The run
 * uses the seller's plan, not Claude API credits. The token is read here only and is
 * never returned or put in an error.
 */
const BETA = "experimental-cc-routine-2026-04-01";
const VERSION = "2023-06-01";

export async function fireRoutine(
  env: Record<string, string | undefined>,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sessionId: string; sessionUrl: string }> {
  const url = env.ROUTINE_FIRE_URL;
  const token = env.ROUTINE_FIRE_TOKEN;
  if (!url || !token) throw new Error("Batch runs are not set up (ROUTINE_FIRE_URL, ROUTINE_FIRE_TOKEN).");
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": BETA,
      "anthropic-version": VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`The batch could not start (status ${res.status}).`);
  const data = (await res.json()) as { claude_code_session_id?: string; claude_code_session_url?: string };
  return { sessionId: data.claude_code_session_id ?? "", sessionUrl: data.claude_code_session_url ?? "" };
}
