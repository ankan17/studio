// media:// protocol with Range support. Call registerMediaScheme() before app.ready, handleMediaProtocol() after.
// Only folders added with allowMediaRoot() (by main, after a user dialog) can be read. Paths are resolved through
// realpath so symlinks cannot escape a root.
import {protocol} from "electron";
import fs from "node:fs";
import path from "node:path";
import {Readable} from "node:stream";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
};

const roots = new Set<string>();

export function allowMediaRoot(dir: string): void {
  roots.add(fs.realpathSync(dir) + path.sep);
}

export function mediaUrl(file: string): string {
  return `media://local${encodeURI(path.resolve(file))}`;
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {scheme: "media", privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true}},
  ]);
}

function parseRange(header: string, size: number): {start: number; end: number} | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return {start, end};
}

export function handleMediaProtocol(): void {
  protocol.handle("media", async (request) => {
    let file: string;
    try {
      file = await fs.promises.realpath(path.resolve(decodeURIComponent(new URL(request.url).pathname)));
    } catch {
      return new Response("Not found", {status: 404});
    }
    if (![...roots].some((r) => file.startsWith(r))) return new Response("Forbidden", {status: 403});
    // Only media types are served, so project.json and index.json are not readable through media://.
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return new Response("Forbidden", {status: 403});
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return new Response("Not found", {status: 404});
    const base = {"Content-Type": mime, "Accept-Ranges": "bytes"};
    const range = request.headers.get("range");
    if (!range) {
      return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
        status: 200,
        headers: {...base, "Content-Length": String(stat.size)},
      });
    }
    const r = parseRange(range, stat.size);
    if (!r) return new Response("Unsatisfiable", {status: 416, headers: {"Content-Range": `bytes */${stat.size}`}});
    return new Response(Readable.toWeb(fs.createReadStream(file, {start: r.start, end: r.end})) as ReadableStream, {
      status: 206,
      headers: {...base, "Content-Range": `bytes ${r.start}-${r.end}/${stat.size}`, "Content-Length": String(r.end - r.start + 1)},
    });
  });
}
