import { describe, expect, it } from "vitest";
import { OFFER_SHARE, offerRoom } from "./offers";

describe("offerRoom", () => {
  it("lists a lowered price so a typical 85% offer lands on the target", () => {
    expect(OFFER_SHARE).toBe(0.85);
    expect(offerRoom(28.99, 11.4)).toBe(13.41);
  });

  it("never lists above today's price, and leaves raises and unknowns alone", () => {
    expect(offerRoom(12, 11)).toBe(12);
    expect(offerRoom(8, 12)).toBe(12);
    expect(offerRoom(null, 12)).toBe(12);
    expect(offerRoom(12, null)).toBeNull();
  });
});
