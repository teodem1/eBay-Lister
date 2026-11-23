/**
 * Browser-only: shrink a phone photo before upload. Claude reads images at
 * up to about 1568px on the long side, so larger photos only cost upload time.
 */
export async function resizeImage(
  file: File,
  maxSide = 1568,
  quality = 0.85,
  opts: { square?: boolean } = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const src = opts.square ? centerSquare(bitmap.width, bitmap.height) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const width = Math.round(src.width * scale);
  const height = Math.round(src.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, src.x, src.y, src.width, src.height, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process the photo"))),
      "image/jpeg",
      quality,
    ),
  );
}

/** The largest centred square in a width x height image (a CD is square: cover, back, disc). */
export function centerSquare(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const side = Math.min(width, height);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side };
}
