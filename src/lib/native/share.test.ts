import { beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => true);
const isPluginAvailable = vi.fn<(name: string) => boolean>(() => true);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform(), isPluginAvailable: (n: string) => isPluginAvailable(n) },
}));

const writeFile = vi.fn<(o: unknown) => Promise<{ uri: string }>>(async () => ({ uri: "file:///cache/backup.json" }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: (o: unknown) => writeFile(o) },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));
const share = vi.fn<(o: unknown) => Promise<object>>(async () => ({}));
vi.mock("@capacitor/share", () => ({ Share: { share: (o: unknown) => share(o) } }));

const writeText = vi.fn(async () => {});
vi.stubGlobal("navigator", { clipboard: { writeText } });

const { saveTextFile } = await import("./share");

beforeEach(() => {
  vi.clearAllMocks();
  isNativePlatform.mockReturnValue(true);
  isPluginAvailable.mockReturnValue(true);
});

describe("saveTextFile in the Android app", () => {
  it("writes the file to the cache and opens the share sheet", async () => {
    expect(await saveTextFile("b.json", "{}", "Backup")).toBe("shared");
    expect(writeFile).toHaveBeenCalledWith({ path: "b.json", data: "{}", directory: "CACHE", encoding: "utf8" });
    expect(share).toHaveBeenCalledWith({ title: "Backup", files: ["file:///cache/backup.json"], dialogTitle: "Backup" });
  });

  it("treats closing the share sheet as cancelled", async () => {
    share.mockRejectedValueOnce(new Error("Share canceled"));
    expect(await saveTextFile("b.json", "{}", "Backup")).toBe("cancelled");
  });

  it("copies the text when the app predates the Share plugin", async () => {
    isPluginAvailable.mockReturnValue(false);
    expect(await saveTextFile("b.json", '{"a":1}', "Backup")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith('{"a":1}');
    expect(share).not.toHaveBeenCalled();
  });
});
