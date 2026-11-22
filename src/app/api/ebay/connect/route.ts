// GET /api/ebay/connect: sends the seller to eBay's sign-in. eBay then redirects
// to /api/ebay/callback, which shows the refresh token for EBAY_REFRESH_TOKEN.
import { randomBytes } from "node:crypto";
import { getEbayConfig } from "@/lib/ebay/config";
import { authorizeUrl } from "@/lib/ebay/oauth";
import { STATE_COOKIE, page } from "../oauth-page";

export async function GET() {
  const config = getEbayConfig();
  const ruName = process.env.EBAY_RUNAME?.trim();
  const missing = [!config.clientId && "EBAY_CLIENT_ID", !config.clientSecret && "EBAY_CLIENT_SECRET", !ruName && "EBAY_RUNAME"]
    .filter(Boolean)
    .join(", ");
  if (missing) {
    return page("Connect eBay", `<p>The server is missing: <b>${missing}</b>. Add it in Vercel and redeploy.</p>`, 500);
  }
  const state = randomBytes(16).toString("hex");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(config, ruName!, state),
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/api/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      "Cache-Control": "no-store",
    },
  });
}
