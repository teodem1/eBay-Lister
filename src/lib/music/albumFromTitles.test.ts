import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { albumFromTitles } from "./albumFromTitles";

const fake = (parsed: unknown) => {
  const parse = vi.fn().mockResolvedValue({ parsed_output: parsed });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
};

describe("albumFromTitles", () => {
  it("returns the artist and album Claude reads off the titles", async () => {
    const { client, parse } = fake({ found: true, artist: "Genesis", album: "Wind & Wuthering" });
    expect(await albumFromTitles(["GENESIS 'WIND & WUTHERING' CD SHIPS FREE TO CANADA"], client)).toEqual({
      artist: "Genesis",
      title: "Wind & Wuthering",
    });
    expect(parse.mock.calls[0][0].messages[0].content).toContain("WIND & WUTHERING");
  });
  it("returns null when the titles disagree or there are none", async () => {
    expect(await albumFromTitles(["a", "b"], fake({ found: false, artist: "", album: "" }).client)).toBeNull();
    expect(await albumFromTitles([], fake({}).client)).toBeNull();
  });
});
