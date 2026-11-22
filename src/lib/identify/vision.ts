/**
 * Identify an item from a photo with Claude vision. Returns structured data
 * plus a keyword query we can send to the eBay Browse API.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const PhotoIdentificationSchema = z.object({
  identified: z
    .boolean()
    .describe("false if the photo does not show a sellable item you can name"),
  title: z.string().describe("Short product name, e.g. 'Nintendo Switch OLED console, white'"),
  brand: z.string().describe("Brand or maker, empty string if unknown"),
  model: z.string().describe("Model name or number, empty string if unknown"),
  category: z.string().describe("Broad eBay-style category, e.g. 'Video Game Consoles'"),
  gtin: z
    .string()
    .describe("UPC/EAN/ISBN digits only if a barcode number is clearly readable, else empty string"),
  conditionNotes: z.string().describe("Visible wear, damage or missing parts; empty if none seen"),
  searchQuery: z
    .string()
    .describe("3 to 8 keywords that would find the same item on eBay"),
  confidence: z.enum(["high", "medium", "low"]),
});

export type PhotoIdentification = z.infer<typeof PhotoIdentificationSchema>;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const SYSTEM = `You identify second-hand items from a seller's phone photo so they can be listed on eBay.
Name the exact product when you can (brand, model, edition, colour, size). When you cannot be sure, give your best guess and lower the confidence instead of refusing.
Read any visible labels, model numbers or barcode digits. Never invent a barcode number.`;

export async function identifyFromPhoto(
  imageBase64: string,
  mediaType: ImageMediaType,
  client: Anthropic = new Anthropic(),
): Promise<PhotoIdentification> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // Retry on another model if this one declines the request.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(PhotoIdentificationSchema),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "What item is this? Fill in every field." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to identify this photo.");
  }
  if (!response.parsed_output) {
    throw new Error(`Could not read Claude's answer (stop reason: ${response.stop_reason}).`);
  }
  return response.parsed_output;
}
