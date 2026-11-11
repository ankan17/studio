// Asset files for one project. Imported media is copied into <project>/assets/<sha256>.<ext> (content addressed, so
// importing the same file twice stores it once) and derived files go to <project>/cache/<sha256>.<kind>.
// Nothing here trusts a path or hash from the renderer: callers pass only validated values.
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {pipeline} from "node:stream/promises";

export type AssetType = "video" | "audio" | "image";
export const MEDIA_EXTENSIONS: Record<string, AssetType> = {
  mp4: "video", mov: "video", m4v: "video",
  mp3: "audio", m4a: "audio", wav: "audio",
  jpg: "image", jpeg: "image", png: "image",
};
export const CACHE_KINDS = ["proxy.mp4", "filmstrip.jpg", "thumb.jpg", "peaks"] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];

const SHA256 = /^[0-9a-f]{64}$/;
export const isSha256 = (v: string): boolean => SHA256.test(v);

export type ImportedFile = {sha256: string; ext: string; relativePath: string; type: AssetType; name: string; sizeBytes: number; existed: boolean};

export class ImportError extends Error {}

/** Extension (lower case, no dot) if it is an importable media type. */
export function mediaExt(file: string): string | null {
  const ext = path.extname(file).slice(1).toLowerCase();
  return ext in MEDIA_EXTENSIONS ? ext : null;
}

export const assetRelativePath = (sha256: string, ext: string): string => `assets/${sha256}.${ext}`;

export function assetFile(projectDir: string, sha256: string, ext: string): string {
  if (!isSha256(sha256) || !(ext in MEDIA_EXTENSIONS)) throw new ImportError("Invalid asset reference.");
  return path.join(projectDir, assetRelativePath(sha256, ext));
}

export function cacheFile(projectDir: string, sha256: string, kind: CacheKind): string {
  if (!isSha256(sha256) || !CACHE_KINDS.includes(kind)) throw new ImportError("Invalid cache reference.");
  return path.join(projectDir, "cache", `${sha256}.${kind}`);
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}
export {exists as fileExists};

/**
 * Copy a media file into the project while hashing it. The source must be a regular file (symlinks are resolved first)
 * with a media extension and must not live under `denyUnder` (the app's own projects folder).
 */
export const MAX_IMPORT_BYTES = 8 * 1024 ** 3;

export async function importAssetFile(projectDir: string, source: string, opts: {denyUnder?: string} = {}): Promise<ImportedFile> {
  if (!path.isAbsolute(source)) throw new ImportError("Media path must be absolute.");
  const real = await fs.realpath(source).catch(() => {
    throw new ImportError(`File not found: ${path.basename(source)}`);
  });
  const ext = mediaExt(real); // the real file's extension counts, never a symlink's name
  if (!ext) throw new ImportError(`Unsupported file type: ${path.basename(source)}`);
  if (opts.denyUnder) {
    const deny = (await fs.realpath(opts.denyUnder)) + path.sep;
    if (real.startsWith(deny)) throw new ImportError("Files inside the Studio data folder cannot be imported.");
  }
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new ImportError(`Not a file: ${path.basename(source)}`);
  if (stat.size === 0) throw new ImportError(`File is empty: ${path.basename(source)}`);
  if (stat.size > MAX_IMPORT_BYTES) throw new ImportError(`File is too large: ${path.basename(source)}`);

  const assets = path.join(projectDir, "assets");
  await fs.mkdir(assets, {recursive: true});
  // The copy must not fill the disk: keep the file's size plus 1GB of headroom free.
  const free = await fs.statfs(assets).then((f) => f.bavail * f.bsize, () => Infinity);
  if (free < stat.size + 1024 ** 3) throw new ImportError(`Not enough free disk space for ${path.basename(source)}.`);
  const tmp = path.join(assets, `.import-${randomUUID()}.tmp`);
  const hash = createHash("sha256");
  try {
    const input = createReadStream(real);
    input.on("data", (chunk: string | Buffer) => hash.update(chunk as Uint8Array));
    await pipeline(input, createWriteStream(tmp, {flags: "wx"}));
    const sha256 = hash.digest("hex");
    const dest = assetFile(projectDir, sha256, ext);
    const existed = await exists(dest);
    if (existed) await fs.rm(tmp, {force: true});
    else await fs.rename(tmp, dest);
    return {sha256, ext, relativePath: assetRelativePath(sha256, ext), type: MEDIA_EXTENSIONS[ext]!, name: path.basename(real), sizeBytes: stat.size, existed};
  } catch (err) {
    await fs.rm(tmp, {force: true});
    throw err;
  }
}

/** Which of these assets have no file in assets/ any more. */
export async function findMissing(projectDir: string, items: {sha256: string; ext: string}[]): Promise<string[]> {
  const missing: string[] = [];
  for (const i of items) if (!(await exists(assetFile(projectDir, i.sha256, i.ext)))) missing.push(i.sha256);
  return missing;
}

/** Delete an asset's copy and everything derived from it. */
export async function removeAssetFiles(projectDir: string, sha256: string, ext: string): Promise<void> {
  await fs.rm(assetFile(projectDir, sha256, ext), {force: true});
  for (const kind of CACHE_KINDS) await fs.rm(cacheFile(projectDir, sha256, kind), {force: true});
}

/** Remove half-written derived files (job start and end). Never touches assets/, where imports may still be copying. */
export async function sweepPartials(projectDir: string): Promise<void> {
  const dir = path.join(projectDir, "cache");
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (name.endsWith(".part")) await fs.rm(path.join(dir, name), {force: true});
  }
}

/**
 * Delete asset copies, with their derived files, that the saved manifest does not reference and that nothing can still
 * be writing (older than ten minutes). A file copied just before the window closed, inside the autosave debounce, ends
 * up like this. Run only when a project opens normally: after a recovery, the damaged newer save may still use them.
 * Returns the hashes removed.
 */
export async function sweepOrphanAssets(projectDir: string, referenced: Iterable<string>, now = Date.now()): Promise<string[]> {
  const keep = new Set(referenced);
  const dir = path.join(projectDir, "assets");
  const removed: string[] = [];
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const dot = name.indexOf(".");
    const sha256 = name.slice(0, dot);
    const ext = name.slice(dot + 1);
    if (dot < 0 || !isSha256(sha256) || !(ext in MEDIA_EXTENSIONS) || keep.has(sha256)) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat || now - stat.mtimeMs <= 10 * 60_000) continue;
    await removeAssetFiles(projectDir, sha256, ext);
    removed.push(sha256);
  }
  return removed;
}

/** Remove import temp files that nothing can still be writing (older than ten minutes). Run when a project opens. */
export async function sweepStaleImports(projectDir: string, now = Date.now()): Promise<void> {
  const dir = path.join(projectDir, "assets");
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!name.endsWith(".tmp")) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat && now - stat.mtimeMs > 10 * 60_000) await fs.rm(path.join(dir, name), {force: true});
  }
}
