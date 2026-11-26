/**
 * Names every CD in one photo of several CDs side by side (spines or covers)
 * with Claude vision. Only reads the photo: no eBay or sold-price calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ImageMediaType } from "./vision";

/** Most CDs read from one photo; more than this is rarely legible. */
export const SHELF_MAX_CDS = 30;

export const ShelfCdSchema = z.object({
  artist: z.string().describe("Artist or group as printed; empty string if unreadable"),
  album: z.string().describe("Album title as printed; empty string if unreadable"),
  year: z.string().describe("Release year (4 digits) only if printed or well known, else empty"),
  edition: z
    .string()
    .describe(
      "Edition words printed on it that change the price: 'Japan', 'box set', 'remastered', '2CD', 'deluxe', 'promo'. Empty if none",
    ),
  barcode: z.string().describe("Barcode digits only if clearly readable in the photo, else empty. Never invent one"),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ShelfSchema = z.object({
  cds: z
    .array(ShelfCdSchema)
    .describe("Every CD you can see, in order: left to right, then top to bottom. Empty if none"),
});

export type ShelfCd = z.infer<typeof ShelfCdSchema>;

const SYSTEM = `You help a used-CD seller sort a pile. The photo shows several CDs side by side: spines on a shelf, or covers laid out.
List every CD you can see, in order (left to right, then top to bottom), one entry each, even if it is partly hidden.
Read the artist and album from the spine or cover text. When the text is hard to read, give your best guess and lower the confidence instead of leaving it out.
Leave out things that are not music CDs (DVDs, games, vinyl records, books). Never invent a barcode number.`;

export async function identifyShelf(
  imageBase64: string,
  mediaType: ImageMediaType,
  client: Anthropic = new Anthropic(),
): Promise<ShelfCd[]> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // Retry on another model if this one declines the request.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(ShelfSchema),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Which CDs are in this photo?" },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this photo.");
  if (!response.parsed_output) {
    throw new Error(`Could not read Claude's answer (stop reason: ${response.stop_reason}).`);
  }
  return cleanShelf(response.parsed_output.cds);
}

/** Drops entries with no artist or album and repeats, and keeps at most SHELF_MAX_CDS. */
export function cleanShelf(cds: ShelfCd[]): ShelfCd[] {
  const seen = new Set<string>();
  const out: ShelfCd[] = [];
  for (const cd of cds) {
    const artist = cd.artist.trim();
    const album = cd.album.trim();
    if (!artist && !album) continue;
    const key = `${artist} ${album} ${cd.edition}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...cd, artist, album, barcode: cd.barcode.replace(/\D/g, "") });
    if (out.length >= SHELF_MAX_CDS) break;
  }
  return out;
}
