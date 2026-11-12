import {describe, expect, it} from "vitest";
import {exportFileName, exportSize, ExportRecordSchema, nextExportVersion} from "./export";

describe("exportSize", () => {
  it("scales the short side and keeps the aspect ratio", () => {
    expect(exportSize(1920, 1080, 720)).toMatchObject({width: 1280, height: 720});
    expect(exportSize(1080, 1920, 720)).toMatchObject({width: 720, height: 1280});
    expect(exportSize(1080, 1350, 720)).toMatchObject({width: 720, height: 900});
    expect(exportSize(1080, 1080, 1080)).toMatchObject({width: 1080, height: 1080, scale: 1});
  });
  it("always gives even sizes", () => {
    for (const [w, h] of [[1001, 563], [1280, 721], [333, 999]] as const) {
      const s = exportSize(w, h, 720);
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
    }
  });
});

describe("exportFileName", () => {
  it("adds the version and strips characters a file name cannot hold", () => {
    expect(exportFileName("My Vlog", 3)).toBe("My Vlog v3.mp4");
    expect(exportFileName("a/b:c*d?", 1)).toBe("a b c d v1.mp4");
    expect(exportFileName("  ..hidden ", 2)).toBe("hidden v2.mp4");
  });
  it("falls back to Untitled and keeps Bengali", () => {
    expect(exportFileName("///", 1)).toBe("Untitled v1.mp4");
    expect(exportFileName("আমার ভ্লগ", 2)).toBe("আমার ভ্লগ v2.mp4");
  });
});

describe("nextExportVersion", () => {
  it("is one more than the highest, never reusing a number", () => {
    expect(nextExportVersion([])).toBe(1);
    expect(nextExportVersion([{version: 1}, {version: 4}, {version: 2}])).toBe(5);
  });
});

describe("ExportRecordSchema", () => {
  it("accepts a finished export and rejects a bad status", () => {
    const rec = {id: "6f9619ff-8b86-4011-b42d-00c04fc964ff", version: 1, fileName: "a v1.mp4", path: "/x/a v1.mp4", height: 1080, width: 1920, outputHeight: 1080, fps: 30, durationFrames: 90, sizeBytes: 10, startedAt: "2026-11-12T00:00:00.000Z", elapsedMs: 5, status: "done"};
    expect(ExportRecordSchema.safeParse(rec).success).toBe(true);
    expect(ExportRecordSchema.safeParse({...rec, status: "weird"}).success).toBe(false);
  });
});
