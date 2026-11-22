import { describe, expect, it } from "vitest";
import { hasValidCheckDigit, normalizeGtin } from "./barcode";

describe("normalizeGtin", () => {
  it("accepts UPC-A, EAN-13 and EAN-8, stripping spaces and dashes", () => {
    expect(normalizeGtin("045496 453435")).toBe("045496453435");
    expect(normalizeGtin("3-700-12345-678-9")).toBe("3700123456789");
    expect(normalizeGtin("96385074")).toBe("96385074");
  });

  it("converts ISBN-10 to ISBN-13", () => {
    expect(normalizeGtin("0-306-40615-2")).toBe("9780306406157");
  });

  it("rejects text and wrong lengths", () => {
    expect(normalizeGtin("hello")).toBeNull();
    expect(normalizeGtin("12345")).toBeNull();
  });
});

describe("hasValidCheckDigit", () => {
  it("checks the GS1 digit", () => {
    expect(hasValidCheckDigit("9780306406157")).toBe(true);
    expect(hasValidCheckDigit("9780306406158")).toBe(false);
    expect(hasValidCheckDigit("96385074")).toBe(true);
  });
});
