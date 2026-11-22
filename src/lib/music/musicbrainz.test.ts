import { describe, expect, it, vi } from "vitest";
import { albumByBarcode, albumByName } from "./musicbrainz";

const q = (url: string) => new URL(url).searchParams.get("query");

function fakeFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const release = {
  id: "rel-1",
  score: 100,
  title: "OK Computer",
  date: "1997-05-21",
  "artist-credit": [{ name: "Radiohead" }],
  "release-group": { id: "rg-1" },
  tags: [
    { name: "rock", count: 2 },
    { name: "alternative rock", count: 5 },
  ],
};

describe("albumByBarcode", () => {
  it("reads album, artist, year, cover and genres", async () => {
    const f = fakeFetch({ releases: [release] });
    const out = await albumByBarcode("0724384260927", f);
    expect(out).toEqual({
      title: "OK Computer",
      artist: "Radiohead",
      year: 1997,
      coverUrl: "https://coverartarchive.org/release-group/rg-1/front-250",
      genres: ["alternative rock", "rock"],
      mbid: "rel-1",
    });
    expect(q(f.mock.calls[0][0])).toBe("barcode:0724384260927 OR barcode:724384260927");
    expect(f.mock.calls[0][1].headers["User-Agent"]).toMatch(/eBayLister/);
  });

  it("joins multi-artist credits and returns null when unknown", async () => {
    const duo = { ...release, "artist-credit": [{ name: "Simon", joinphrase: " & " }, { name: "Garfunkel" }] };
    expect((await albumByBarcode("1", fakeFetch({ releases: [duo] })))?.artist).toBe("Simon & Garfunkel");
    expect(await albumByBarcode("1", fakeFetch({ releases: [] }))).toBeNull();
    await expect(albumByBarcode("1", fakeFetch({}, 503))).rejects.toThrow("503");
  });
});

describe("albumByName", () => {
  it("only trusts strong name matches", async () => {
    expect(await albumByName("OK Computer", "Radiohead", fakeFetch({ releases: [{ ...release, score: 60 }] }))).toBeNull();
    const f = fakeFetch({ releases: [release] });
    expect((await albumByName('OK "Computer"', "Radiohead", f))?.title).toBe("OK Computer");
    expect(q(f.mock.calls[0][0])).toBe('release:"OK \\"Computer\\"" AND artist:"Radiohead"');
  });
});
