import Anthropic from "@anthropic-ai/sdk";
import { getEbayConfig } from "@/lib/ebay/config";
import { EbaySellClient } from "@/lib/ebay/sell";
import { claudeErrorMessage, claudeErrorStatus } from "@/lib/claude/errors";
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
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: claudeErrorMessage(err) }, { status: claudeErrorStatus(err) });
    }
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
