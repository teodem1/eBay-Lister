// GET /api/ebay/callback?code=&state=: eBay's "auth accepted" redirect. Trades the
// code for a refresh token and shows it once so the seller can paste it into
// EBAY_REFRESH_TOKEN. Nothing is stored on the server.
import { getEbayConfig } from "@/lib/ebay/config";
import { exchangeCode } from "@/lib/ebay/oauth";
import { STATE_COOKIE, escapeHtml, page } from "../oauth-page";

const CLEAR_STATE = { "Set-Cookie": `${STATE_COOKIE}=; Path=/api/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=0` };

function cookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ruName = process.env.EBAY_RUNAME?.trim();

  if (!code) {
    return page("eBay not connected", "<p>eBay did not send a sign-in code (the sign-in was cancelled or declined). <a href=\"/api/ebay/connect\">Try again</a>.</p>", 400, CLEAR_STATE);
  }
  if (!state || state !== cookie(request, STATE_COOKIE)) {
    return page("eBay not connected", "<p>This sign-in link expired or was opened in another browser. <a href=\"/api/ebay/connect\">Start again</a>.</p>", 400, CLEAR_STATE);
  }
  if (!ruName) return page("eBay not connected", "<p>The server is missing <b>EBAY_RUNAME</b>.</p>", 500, CLEAR_STATE);

  const config = getEbayConfig();
  try {
    const { refreshToken, refreshTokenExpiresIn } = await exchangeCode(config, ruName, code);
    const expires = refreshTokenExpiresIn
      ? new Date(Date.now() + refreshTokenExpiresIn * 1000).toISOString().slice(0, 10)
      : "in about 18 months";
    return page(
      "eBay connected",
      `<p>Copy this refresh token into Vercel as <b>EBAY_REFRESH_TOKEN</b> (${escapeHtml(config.env)}), then redeploy. It expires ${escapeHtml(expires)}. It is not stored anywhere else, so keep this page private.</p>
<textarea id="t" readonly>${escapeHtml(refreshToken)}</textarea>
<button onclick="navigator.clipboard.writeText(document.getElementById('t').value);this.textContent='Copied'">Copy</button>`,
      200,
      CLEAR_STATE,
    );
  } catch (err) {
    console.error("eBay code exchange failed", err);
    return page("eBay not connected", `<p>eBay refused the sign-in code: ${escapeHtml((err as Error).message)}. <a href="/api/ebay/connect">Try again</a>.</p>`, 502, CLEAR_STATE);
  }
}
