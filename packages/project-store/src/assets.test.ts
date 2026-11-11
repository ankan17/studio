import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {findMissing, ImportError, importAssetFile, removeAssetFiles, sweepPartials, sweepStaleImports, cacheFile} from "./assets";

let tmp: string;
let proj: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "studio-assets-"));
  proj = path.join(tmp, "proj");
  await fs.mkdir(proj);
});
afterEach(() => fs.rm(tmp, {recursive: true, force: true}));

const write = async (name: string, body: string) => {
  const f = path.join(tmp, name);
  await fs.writeFile(f, body);
  return f;
};

describe("importAssetFile", () => {
  it("copies into assets/<sha256>.<ext> and reports the hash", async () => {
    const src = await write("Clip One.MOV", "hello video");
    const r = await importAssetFile(proj, src);
    expect(r.sha256).toBe(createHash("sha256").update("hello video").digest("hex"));
    expect(r).toMatchObject({ext: "mov", type: "video", name: "Clip One.MOV", existed: false, sizeBytes: 11});
    expect(await fs.readFile(path.join(proj, r.relativePath), "utf8")).toBe("hello video");
  });
  it("de-duplicates identical content under different names", async () => {
    const a = await importAssetFile(proj, await write("a.mp4", "same"));
    const b = await importAssetFile(proj, await write("b.mp4", "same"));
    expect(b.sha256).toBe(a.sha256);
    expect(b.existed).toBe(true);
    expect(await fs.readdir(path.join(proj, "assets"))).toEqual([`${a.sha256}.mp4`]); // no temp files left
  });
  it("rejects unsupported types, empty files, directories, relative paths and missing files", async () => {
    await expect(importAssetFile(proj, await write("notes.txt", "x"))).rejects.toThrow(ImportError);
    await expect(importAssetFile(proj, await write("e.mp4", ""))).rejects.toThrow(/empty/);
    await fs.mkdir(path.join(tmp, "dir.mp4"));
    await expect(importAssetFile(proj, path.join(tmp, "dir.mp4"))).rejects.toThrow(/Not a file/);
    await expect(importAssetFile(proj, "rel/a.mp4")).rejects.toThrow(/absolute/);
    await expect(importAssetFile(proj, path.join(tmp, "nope.mp4"))).rejects.toThrow(/not found/);
  });
  it("refuses files inside the app data folder, including through a symlink", async () => {
    const inside = path.join(proj, "secret.mp4");
    await fs.writeFile(inside, "x");
    await expect(importAssetFile(proj, inside, {denyUnder: tmp})).rejects.toThrow(/data folder/);
    const link = path.join(os.tmpdir(), `studio-link-${Date.now()}.mp4`);
    await fs.symlink(inside, link);
    try {
      await expect(importAssetFile(proj, link, {denyUnder: tmp})).rejects.toThrow(/data folder/);
    } finally {
      await fs.rm(link);
    }
  });
  it("does not follow a symlink to a non-media file", async () => {
    const target = await write("passwd.txt", "root");
    const link = path.join(tmp, "innocent.mp4");
    await fs.symlink(target, link);
    // The extension that counts is the real file's; the link's name alone must not smuggle it in.
    await expect(importAssetFile(proj, link)).rejects.toThrow(ImportError);
  });
});

describe("asset helpers", () => {
  it("finds missing assets and removes an asset with its cache", async () => {
    const r = await importAssetFile(proj, await write("a.mp4", "data"));
    expect(await findMissing(proj, [{sha256: r.sha256, ext: "mp4"}])).toEqual([]);
    await fs.mkdir(path.join(proj, "cache"));
    await fs.writeFile(cacheFile(proj, r.sha256, "proxy.mp4"), "p");
    await removeAssetFiles(proj, r.sha256, "mp4");
    expect(await findMissing(proj, [{sha256: r.sha256, ext: "mp4"}])).toEqual([r.sha256]);
    expect(await fs.readdir(path.join(proj, "cache"))).toEqual([]);
  });
  it("validates hashes so a crafted value cannot build a path", () => {
    expect(() => cacheFile(proj, "../../etc/passwd", "proxy.mp4")).toThrow(ImportError);
    expect(() => cacheFile(proj, "a".repeat(64), "../x" as never)).toThrow(ImportError);
  });
  it("sweeps partial cache files but never a live import in assets/", async () => {
    await fs.mkdir(path.join(proj, "cache"));
    await fs.mkdir(path.join(proj, "assets"));
    await fs.writeFile(path.join(proj, "cache", "x.proxy.mp4.part"), "x");
    await fs.writeFile(path.join(proj, "cache", "keep.jpg"), "x");
    await fs.writeFile(path.join(proj, "assets", ".import-live.tmp"), "copying");
    await sweepPartials(proj);
    expect(await fs.readdir(path.join(proj, "cache"))).toEqual(["keep.jpg"]);
    expect(await fs.readdir(path.join(proj, "assets"))).toEqual([".import-live.tmp"]);
  });
  it("removes import temp files only once they are stale", async () => {
    await fs.mkdir(path.join(proj, "assets"));
    await fs.writeFile(path.join(proj, "assets", ".import-old.tmp"), "x");
    await sweepStaleImports(proj);
    expect(await fs.readdir(path.join(proj, "assets"))).toHaveLength(1);
    await sweepStaleImports(proj, Date.now() + 11 * 60_000);
    expect(await fs.readdir(path.join(proj, "assets"))).toHaveLength(0);
  });
});
