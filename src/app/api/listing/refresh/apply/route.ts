import { z } from "zod";
import { applyRefresh } from "@/lib/ebay/refreshListings";
import { sanitizeDescription } from "@/lib/listing/generate";
import { TITLE_MAX } from "@/lib/listing/limits";
import { errorResponse, sellClient } from "../shared";

const Body = z.object({
  sku: z.string().min(1).max(50),
  /** The title the preview saw; the listing is skipped if eBay has another one now. */
  expectedTitle: z.string(),
  after: z.object({
    title: z.string().min(1).max(TITLE_MAX),
    aspects: z.record(z.string(), z.array(z.string()).max(30)),
    descriptionHtml: z.string().min(1).max(500_000),
  }),
});

/**
 * POST a previewed rewrite: replaces only the live listing's title, item specifics
 * and description. Price, Best Offer, shipping, promotion and photos are kept.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The rewrite is not complete." }, { status: 400 });
  const got = sellClient();
  if (got instanceof Response) return got;
  const { sku, expectedTitle, after } = parsed.data;
  try {
    return Response.json(
      await applyRefresh(got.client, sku, expectedTitle, { ...after, descriptionHtml: sanitizeDescription(after.descriptionHtml) }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
