// Experiment 1: media:// protocol with Range support. Call registerMediaScheme() before app.ready,
// then handleMediaProtocol(allowedRoot) after. Paths outside allowedRoot are rejected.
import {protocol} from "electron";
import fs from "node:fs";
import path from "node:path";
import {Readable} from "node:stream";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".jpg": "image/jpeg", ".png": "image/png",
};

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {scheme: "media", privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true}},
  ]);
}

// bytes = bytes actually streamed to the client so far; start/end = the range it asked for.
export type RangeEntry = {file: string; status: 200 | 206; start: number; end: number; bytes: number; size: number};
let rangeLog: RangeEntry[] = [];
export function takeRangeLog(): RangeEntry[] {
  const out = rangeLog;
  rangeLog = [];
  return out;
}

function counted(file: string, entry: RangeEntry, opts?: {start: number; end: number}): ReadableStream {
  const node = fs.createReadStream(file, opts);
  node.on("data", (chunk: string | Buffer) => {
    entry.bytes += chunk.length;
  });
  return Readable.toWeb(node) as ReadableStream;
}
export function handleMediaProtocol(allowedRoots: string[]): void {
  const roots = allowedRoots.map((r) => path.resolve(r) + path.sep);
  protocol.handle("media", async (request) => {
    const url = new URL(request.url);
    const file = path.resolve(decodeURIComponent(url.pathname));
    if (!roots.some((r) => file.startsWith(r))) return new Response("Forbidden", {status: 403});
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(file); } catch { return new Response("Not found", {status: 404}); }
    const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = request.headers.get("range");
    const base = {"Content-Type": mime, "Accept-Ranges": "bytes"};

    if (!range) {
      const entry: RangeEntry = {file: path.basename(file), status: 200, start: 0, end: stat.size - 1, bytes: 0, size: stat.size};
      rangeLog.push(entry);
      return new Response(counted(file, entry), {
        status: 200, headers: {...base, "Content-Length": String(stat.size)},
      });
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return new Response("Bad range", {status: 416});
    const start = m[1] === "" ? stat.size - Number(m[2]) : Number(m[1]);
    let end = m[1] !== "" && m[2] !== "" ? Number(m[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      return new Response("Unsatisfiable", {status: 416, headers: {"Content-Range": `bytes */${stat.size}`}});
    }
    const entry: RangeEntry = {file: path.basename(file), status: 206, start, end, bytes: 0, size: stat.size};
    rangeLog.push(entry);
    return new Response(counted(file, entry, {start, end}), {
      status: 206,
      headers: {...base, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1)},
    });
  });
}
