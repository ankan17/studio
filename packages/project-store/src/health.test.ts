import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {assertFreeSpace, beginSession, endSession, freeBytes, friendlyErrorText, friendlyFsError, NotEnoughSpaceError} from "./index";

let dir: string;
beforeEach(async () => void (dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-health-"))));
afterEach(() => fs.rm(dir, {recursive: true, force: true}));
const err = (code: string) => Object.assign(new Error("x"), {code});

describe("friendlyFsError", () => {
  it("explains the failures a user can act on", () => {
    expect(friendlyFsError(err("ENOSPC"))).toMatch(/disk is full/i);
    expect(friendlyFsError(err("EACCES"))).toMatch(/not allowed/i);
    expect(friendlyFsError(err("EROFS"))).toMatch(/read-only/i);
    expect(friendlyFsError(err("EIO"))).toMatch(/external drive/i);
  });
  it("returns null for anything else", () => {
    expect(friendlyFsError(err("EEXIST"))).toBeNull();
    expect(friendlyFsError(new Error("boom"))).toBeNull();
    expect(friendlyFsError(null)).toBeNull();
  });
});

describe("friendlyErrorText", () => {
  it("recognises disk errors that only arrive as text", () => {
    expect(friendlyErrorText("Error invoking remote method 'render:write': Error: ENOSPC: no space left on device, write")).toMatch(/disk is full/i);
    expect(friendlyErrorText("EROFS: read-only file system")).toMatch(/read-only/i);
    expect(friendlyErrorText("something else")).toBeNull();
  });
});

describe("free space", () => {
  it("reads the free space of an existing folder and of one that does not exist yet", async () => {
    expect(await freeBytes(dir)).toBeGreaterThan(0);
    expect(await freeBytes(path.join(dir, "not", "yet"))).toBeGreaterThan(0);
  });
  it("passes when there is room and throws a readable error when there is not", async () => {
    await expect(assertFreeSpace(dir, 1)).resolves.toBeUndefined();
    const e = await assertFreeSpace(dir, 1e18).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NotEnoughSpaceError);
    expect((e as Error).message).toMatch(/Not enough free disk space/);
  });
});

describe("session lock", () => {
  it("a first start and a clean quit are not crashes", async () => {
    expect(await beginSession(dir, 100, () => false)).toBe(false);
    await endSession(dir);
    expect(await beginSession(dir, 101, () => false)).toBe(false);
  });
  it("a lock left behind by a dead process is a crash, and the new session takes the lock over", async () => {
    await beginSession(dir, 100, () => false);
    expect(await beginSession(dir, 101, () => false)).toBe(true);
    await endSession(dir);
    expect(await beginSession(dir, 102, () => false)).toBe(false);
  });
  it("a lock held by a live process is not a crash", async () => {
    await beginSession(dir, 100, () => true);
    expect(await beginSession(dir, 101, () => true)).toBe(false);
  });
  it("a damaged lock counts as a crash", async () => {
    await fs.writeFile(path.join(dir, "session.lock"), "{half");
    expect(await beginSession(dir, 100, () => false)).toBe(true);
  });
  it("ending a session that never began is harmless", async () => {
    await expect(endSession(dir)).resolves.toBeUndefined();
  });
});
