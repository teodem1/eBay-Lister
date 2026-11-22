import { getEbayConfig } from "@/lib/ebay/config";
import { EbayApiError, EbaySellClient } from "@/lib/ebay/sell";

// Vercel caps request bodies at about 4.5 MB; the phone shrinks photos before sending.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif", "image/tiff", "image/bmp"]);

/** POST multipart { photo } -> { url } hosted by eBay, ready for the listing's imageUrls. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return Response.json({ error: "Send a photo as multipart field \"photo\"." }, { status: 400 });
  }
  if (photo.size > MAX_BYTES) {
    return Response.json({ error: "That photo is too large (max 4 MB)." }, { status: 413 });
  }
  if (photo.type && !TYPES.has(photo.type)) {
    return Response.json({ error: "eBay accepts JPG, PNG, WEBP, HEIC, GIF, TIFF or BMP photos." }, { status: 400 });
  }

  const config = getEbayConfig();
  if (!config.clientId || !config.clientSecret || (!config.refreshToken && !config.userToken)) {
    return Response.json({ error: "Server is missing eBay settings for photo upload (EBAY_REFRESH_TOKEN)." }, { status: 500 });
  }
  try {
    const name = photo instanceof File && photo.name ? photo.name : "photo.jpg";
    const url = await new EbaySellClient(config).uploadImage(photo, name);
    return Response.json({ url });
  } catch (err) {
    const status = err instanceof EbayApiError ? 502 : 500;
    return Response.json({ error: `Photo upload failed: ${(err as Error).message}` }, { status });
  }
}
