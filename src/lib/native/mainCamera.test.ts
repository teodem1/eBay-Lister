import { describe, expect, it } from "vitest";
import { pickMainBackCamera } from "./mainCamera";

const cam = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" });

describe("pickMainBackCamera", () => {
  it("picks camera2 0 among Android back lenses", () => {
    expect(
      pickMainBackCamera([cam("f", "camera2 1, facing front"), cam("uw", "camera2 2, facing back"), cam("main", "camera2 0, facing back")]),
    ).toBe("main");
  });
  it("skips lenses named ultra wide or telephoto", () => {
    expect(
      pickMainBackCamera([cam("uw", "Back Ultra Wide Camera"), cam("t", "Back Telephoto Camera"), cam("d", "Back Triple Camera"), cam("main", "Back Camera")]),
    ).toBe("main");
  });
  it("returns null when labels are hidden", () => {
    expect(pickMainBackCamera([cam("a", ""), cam("b", "")])).toBeNull();
  });
});
