/**
 * Browser-only: shrink a phone photo before upload. Claude reads images at
 * up to about 1568px on the long side, so larger photos only cost upload time.
 */
export async function resizeImage(file: File, maxSide = 1568, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process the photo"))),
      "image/jpeg",
      quality,
    ),
  );
}
