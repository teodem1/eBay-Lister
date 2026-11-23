import { describe, expect, it } from "vitest";
import { centerSquare } from "./resize-image";

describe("centerSquare", () => {
  it("crops the middle square of a portrait or landscape photo", () => {
    expect(centerSquare(3000, 4000)).toEqual({ x: 0, y: 500, width: 3000, height: 3000 });
    expect(centerSquare(4000, 3000)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
    expect(centerSquare(1000, 1000)).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });
});
