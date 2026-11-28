/**
 * POST /api/learning/outcome {barcode?, artist, title, soldPrice, soldAt} (phone only, from Collection's
 * "Mark as sold"): places the sale price among the CD's stored same-grade sales, counts the copies listed
 * on eBay now (Browse, no sold lookup), and saves the record that future price proposals learn from.
 * Nothing is shown to the seller.
 */
import { z } from "zod";
import { refuseKeyHeader } from "@/app/api/batch/shared";
import { lookupKeys } from "@/lib/comps/record";
import { blobBackend } from "@/lib/comps/store";
import { getEbayClient } from "@/lib/ebay";
import { findCurrentListings } from "@/lib/ebay/comparables";
import { engagementLevel, median, percentileOf, type SaleOutcome } from "@/lib/learning/outcomes";
import { recordOutcome } from "@/lib/learning/store";
import { listingSales } from "@/lib/liveBatch/sales";
import { onlyCds, searchName } from "@/lib/pricing/version";

const Body = z.object({
  barcode: z.string().max(20).optional(),
  artist: z.string().max(200),
  title: z.string().min(1).max(200),
  soldPrice: z.number().positive().max(100_000),
  soldAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request) {
  const refused = refuseKeyHeader(request);
  if (refused) return refused;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid sale." }, { status: 400 });
  const { barcode, artist, title, soldPrice, soldAt } = parsed.data;
  const name = `${artist} ${title}`.trim();
  const [key] = lookupKeys({ barcode, name: searchName(name) });
  if (!key) return Response.json({ saved: false });
  const b = blobBackend();
  if (!b) return Response.json({ saved: false });

  try {
    const stored = await listingSales(b, { barcode, query: name });
    const values = stored.sales.filter((s) => s.price.currency === "CAD").map((s) => s.price.value);
    let listedNow: number | null = null;
    try {
      const ebay = getEbayClient();
      const digits = (barcode ?? "").replace(/\D/g, "");
      const { items } = await findCurrentListings(ebay, {
        gtin: digits.length >= 8 && digits.length <= 14 ? digits : undefined,
        keywords: searchName(name),
        limit: 200,
        destinationCountry: ebay.config.marketplaceId.replace(/^EBAY_/, ""),
      });
      listedNow = onlyCds(items, name).length;
    } catch (err) {
      console.error("counting current listings for a sale failed", err);
    }
    const outcome: SaleOutcome = {
      key,
      ...(barcode && { barcode }),
      name,
      soldAt,
      soldPrice,
      percentile: percentileOf(soldPrice, values),
      salesCount: values.length,
      median: values.length ? Math.round(median(values) * 100) / 100 : null,
      listedNow,
      // Interest is measured as everywhere else (Scan, Auto, the skill): CD sales in any grade against CDs listed now.
      level: listedNow === null ? null : engagementLevel(stored.cds, stored.savedAt ?? new Date().toISOString(), listedNow),
      recordedAt: new Date().toISOString(),
    };
    await recordOutcome(b, outcome);
    return Response.json({ saved: true });
  } catch (err) {
    console.error("recording a sale failed", err);
    return Response.json({ error: "The sale could not be recorded." }, { status: 502 });
  }
}
