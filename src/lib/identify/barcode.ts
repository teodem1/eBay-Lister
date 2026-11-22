/**
 * Barcode helpers shared by the scanner (client) and the API route (server).
 */

/** Strips spaces and dashes; returns null unless the result looks like a UPC/EAN/ISBN. */
export function normalizeGtin(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (/^\d{8}$|^\d{12,14}$/.test(digits)) return digits;
  // ISBN-10 can end in X; eBay accepts ISBN-13, so convert.
  if (/^\d{9}[\dXx]$/.test(digits)) return isbn10To13(digits);
  return null;
}

/** GS1 check digit test for EAN-8, UPC-A, EAN-13 and GTIN-14. */
export function hasValidCheckDigit(gtin: string): boolean {
  const digits = gtin.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function isbn10To13(isbn10: string): string {
  const core = "978" + isbn10.slice(0, 9);
  const sum = core
    .split("")
    .map(Number)
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return core + String((10 - (sum % 10)) % 10);
}
