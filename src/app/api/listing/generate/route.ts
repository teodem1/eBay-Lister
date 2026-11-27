import Anthropic from "@anthropic-ai/sdk";
import { getEbayConfig } from "@/lib/ebay/config";
import { EbaySellClient } from "@/lib/ebay/sell";
import { generateListing } from "@/lib/listing/generate";
import { ItemInputSchema } from "@/lib/listing/types";
import { albumByBarcode } from "@/lib/music/musicbrainz";

export async function POST(request: Request) {
  const parsed = ItemInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }

  const config = getEbayConfig();
  const ebay = config.clientId && config.clientSecret ? new EbaySellClient(config) : undefined;

  try {
    const result = await generateListing(parsed.data, {
      anthropic: new Anthropic(),
      ebay,
      config,
      albumFacts: (barcode) => albumByBarcode(barcode),
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "Claude API key missing or invalid (ANTHROPIC_API_KEY)." }, { status: 500 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Claude is rate limited. Try again in a minute." }, { status: 429 });
    }
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
