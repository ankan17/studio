// Reliability helpers used from main: plain-language disk errors, a free-space check, and the session lock that tells
// the next start whether the last session ended cleanly. Node only.
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** A readable sentence for the file-system failures a user can act on, or null for anything else. */
export function friendlyFsError(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case "ENOSPC":
      return "The disk is full. Free some space and Studio will try again.";
    case "EDQUOT":
      return "The disk quota is used up. Free some space and Studio will try again.";
    case "EROFS":
      return "The disk is read-only, so nothing can be saved there.";
    case "EACCES":
    case "EPERM":
      return "Studio is not allowed to write there. Check the folder's permissions.";
    case "EIO":
      return "The disk reported a read or write error. If it is an external drive, check that it is still connected.";
    case "ENOENT":
      return "A file or folder Studio needed is missing. If it is on an external drive, check that it is connected.";
    default:
      return null;
  }
}

/** The same for an error that only arrives as text (it crossed IPC or came out of a render window). */
export function friendlyErrorText(message: string): string | null {
  if (/ENOSPC|no space left/i.test(message)) return friendlyFsError({code: "ENOSPC"});
  if (/EDQUOT/.test(message)) return friendlyFsError({code: "EDQUOT"});
  if (/EROFS|read-only file system/i.test(message)) return friendlyFsError({code: "EROFS"});
  return null;
}

export class NotEnoughSpaceError extends Error {
  constructor(readonly neededBytes: number, readonly freeBytes: number) {
    super(`Not enough free disk space: about ${fmt(neededBytes)} needed, ${fmt(freeBytes)} free.`);
  }
}
const fmt = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** Free bytes on the volume holding `dir` (the nearest folder that exists), or null when the platform cannot say. */
export async function freeBytes(dir: string): Promise<number | null> {
  let cur = dir;
  for (;;) {
    try {
      const s = await fs.statfs(cur);
      return Number(s.bavail) * Number(s.bsize);
    } catch (err) {
      const parent = path.dirname(cur);
      if (parent === cur || (err as NodeJS.ErrnoException).code !== "ENOENT") return null;
      cur = parent;
    }
  }
}

/** Throws NotEnoughSpaceError when the volume holding `dir` has less than `needBytes` free. Unknown free space passes. */
export async function assertFreeSpace(dir: string, needBytes: number): Promise<void> {
  const free = await freeBytes(dir);
  if (free !== null && free < needBytes) throw new NotEnoughSpaceError(needBytes, free);
}

// ---- session lock
const lockFile = (root: string) => path.join(root, "session.lock");

/**
 * Marks a session as running. Returns true when the lock from the last session was still there, which means that
 * session did not end cleanly (crash, force quit, power loss). The lock holds the process id, so two running copies
 * of the app can tell a live session from a dead one: a lock whose process is alive is not counted as a crash.
 */
export async function beginSession(root: string, pid = process.pid, isAlive: (pid: number) => boolean = processAlive): Promise<boolean> {
  let crashed = false;
  try {
    const prev = JSON.parse(await fs.readFile(lockFile(root), "utf8")) as {pid?: number};
    crashed = typeof prev.pid !== "number" || prev.pid === pid || !isAlive(prev.pid);
  } catch (err) {
    // no lock is a clean start; an unreadable lock is a session that died while writing it
    crashed = (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
  await fs.mkdir(root, {recursive: true});
  await fs.writeFile(lockFile(root), JSON.stringify({pid, startedAt: new Date().toISOString()}));
  return crashed;
}

/** A clean quit removes the lock. */
export async function endSession(root: string): Promise<void> {
  await fs.rm(lockFile(root), {force: true});
}

/** For the app's quit handler, which cannot wait for a promise. */
export function endSessionSync(root: string): void {
  if (root) fsSync.rmSync(lockFile(root), {force: true});
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
