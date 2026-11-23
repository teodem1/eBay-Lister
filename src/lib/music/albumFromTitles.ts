/**
 * The album name when MusicBrainz doesn't know a barcode: Claude reads the
 * eBay listing titles for that barcode ("GENESIS 'WIND & WUTHERING' CD SHIPS
 * FREE TO CANADA") and returns just the artist and album.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const ALBUM_MODEL = "claude-haiku-5-5";

const AlbumGuessSchema = z.object({
  found: z.boolean().describe("false if the titles are not one music release or disagree"),
  artist: z.string().describe("Artist or group as usually written, e.g. 'Genesis'"),
  album: z.string().describe("Album title only, e.g. 'Wind & Wuthering'"),
});
export type AlbumGuess = z.infer<typeof AlbumGuessSchema>;

const SYSTEM = `You get eBay listing titles for one barcode (a music CD). Return the artist and album title only.
Drop everything else: format (CD, vinyl), condition, edition notes, country, shipping, catalogue numbers, years, seller words.
Use normal capitalisation, not ALL CAPS. If the titles are not clearly one release, set found=false.`;

export async function albumFromTitles(
  titles: string[],
  client: Anthropic = new Anthropic(),
): Promise<{ artist: string; title: string } | null> {
  const sample = titles.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  if (!sample.length) return null;
  const response = await client.beta.messages.parse({
    model: ALBUM_MODEL,
    max_tokens: 1000,
    output_config: { format: betaZodOutputFormat(AlbumGuessSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: sample.map((t) => `- ${t}`).join("\n") }],
  });
  const out = response.parsed_output;
  if (!out?.found || !out.album.trim()) return null;
  return { artist: out.artist.trim(), title: out.album.trim() };
}
