import { describe, expect, it, vi } from "vitest";
import { albumByBarcode, albumByName, releaseFactsText } from "./musicbrainz";

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
      release: { date: "1997-05-21" },
    });
    expect(q(f.mock.calls[0][0])).toBe("barcode:0724384260927 OR barcode:724384260927");
    expect(f.mock.calls[0][1].headers["User-Agent"]).toMatch(/eBayLister/);
  });

  it("reads the pressing: label, catalog number, country, discs", async () => {
    const pressing = {
      ...release,
      country: "CA",
      packaging: "Jewel Case",
      "label-info": [{ "catalog-number": "CDP 7243 8 55229 2 5", label: { name: "Parlophone" } }],
      media: [{ format: "CD" }, { format: "CD" }],
    };
    const out = await albumByBarcode("1", fakeFetch({ releases: [pressing] }));
    expect(out?.release).toEqual({
      label: "Parlophone",
      catalogNumber: "CDP 7243 8 55229 2 5",
      country: "CA",
      date: "1997-05-21",
      discs: 2,
      format: "CD",
      packaging: "Jewel Case",
    });
    const text = releaseFactsText(out!);
    expect(text).toContain("Country of release: Canada");
    expect(text).toContain("Record label: Parlophone");
    expect(text).toContain("Number of discs: 2");
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
