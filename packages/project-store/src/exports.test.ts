import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {ExportRecord} from "@studio/schema";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {addExport, exportLogFile, exportsFile, readExports} from "./index";

let dir: string;
beforeEach(async () => void (dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-exports-"))));
afterEach(() => fs.rm(dir, {recursive: true, force: true}));

const rec = (n: number, status: ExportRecord["status"] = "done"): ExportRecord => ({
  id: `6f9619ff-8b86-4011-b42d-00c04fc964f${n}`, version: n, fileName: `a v${n}.mp4`, path: `/x/a v${n}.mp4`, height: 1080, width: 1920, outputHeight: 1080,
  fps: 30, durationFrames: 90, sizeBytes: 10, startedAt: "2026-11-12T00:00:00.000Z", elapsedMs: 5, status,
});

describe("export history", () => {
  it("is empty when there is no file", async () => {
    expect(await readExports(dir)).toEqual([]);
  });
  it("appends in order and reads back", async () => {
    await addExport(dir, rec(1));
    await addExport(dir, rec(2, "cancelled"));
    expect((await readExports(dir)).map((r) => [r.version, r.status])).toEqual([[1, "done"], [2, "cancelled"]]);
  });
  it("treats a damaged file as empty and drops invalid entries", async () => {
    await fs.writeFile(exportsFile(dir), "{not json");
    expect(await readExports(dir)).toEqual([]);
    await fs.writeFile(exportsFile(dir), JSON.stringify([rec(1), {version: "x"}]));
    expect(await readExports(dir)).toHaveLength(1);
  });
  it("only makes log paths from a valid export id", () => {
    expect(exportLogFile(dir, rec(1).id)).toBe(path.join(dir, "exports", `${rec(1).id}.log`));
    expect(() => exportLogFile(dir, "../x")).toThrow(/Invalid export id/);
  });
});
