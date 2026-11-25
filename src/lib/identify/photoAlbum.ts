import type { PhotoIdentification } from "./vision";
import { albumByBarcode, albumByName, type AlbumInfo } from "../music/musicbrainz";

/** Album details for a photographed CD: by barcode if Claude read one, else by name. */
export async function photoAlbum(
  id: PhotoIdentification,
  gtin: string | undefined,
): Promise<AlbumInfo | null> {
  const music = id.music;
  if (!music?.album.trim()) return gtin ? albumByBarcode(gtin) : null;
  const found = (gtin ? await albumByBarcode(gtin) : null) ?? (await albumByName(music.album, music.artist));
  if (found) return found;
  // MusicBrainz doesn't know it: keep what Claude read off the cover.
  const year = Number(music.year);
  return {
    title: music.album.trim(),
    artist: music.artist.trim(),
    year: Number.isInteger(year) && year > 1800 ? year : undefined,
    genres: [],
    mbid: "",
  };
}
