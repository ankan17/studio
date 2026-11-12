// Runs in the hidden worker window (WebCodecs is not available in Node). For each job from main it reads the source
// through media://, then produces: metadata, a 720p H.264 constant-frame-rate proxy, a poster thumbnail, a filmstrip
// sprite and audio peaks. Derived files are written through IPC to paths main chooses.
import {
  ALL_FORMATS, AudioSampleSink, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource,
  type InputVideoTrack, type StreamTargetChunk,
} from "mediabunny";
import type {MediaMeta, Stage, WorkerJob} from "./ipc";
import type {WorkerApi} from "./worker-preload";

declare global {
  interface Window {
    mediaWorker: WorkerApi;
  }
}

const PEAK_WINDOW_S = 0.01;
const FILMSTRIP_TILES = 60;
const TILE_W = 160;
const TILE_H = 90;
const THUMB_LONG_SIDE = 320;
const PROXY_SHORT_SIDE = 720;
const PROXY_BITRATE = 4_000_000;
const FLUSH_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_DURATION_S = 12 * 3600;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Proxy size from the picture as displayed (after rotation): short side 720, never upscaled, even numbers. */
export function proxySize(displayWidth: number, displayHeight: number): {width: number; height: number} {
  const scale = Math.min(1, PROXY_SHORT_SIDE / Math.min(displayWidth, displayHeight));
  return {width: even(displayWidth * scale), height: even(displayHeight * scale)};
}

/** Constant frame rate for the proxy: the source's nearest rate, at most 30 (24, 25 and 30 stay as they are). */
export function proxyFps(sourceFps: number | undefined): number {
  return sourceFps && sourceFps > 0 ? Math.min(30, Math.round(sourceFps)) : 30;
}

// Joins neighbouring writes so IPC carries a few large chunks, not thousands of small ones.
export function coalescingWritable(write: (position: number, data: Uint8Array) => Promise<void>) {
  let start = 0;
  let parts: Uint8Array[] = [];
  let size = 0;
  const flush = async () => {
    if (size === 0) return;
    const all = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.byteLength;
    }
    const at = start;
    parts = [];
    size = 0;
    await write(at, all);
  };
  return new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      if (size > 0 && chunk.position !== start + size) await flush();
      if (size === 0) start = chunk.position;
      parts.push(chunk.data.slice());
      size += chunk.data.byteLength;
      if (size >= FLUSH_BYTES) await flush();
    },
    close: flush,
  });
}

/** Width and height from a PNG or JPEG header, without decoding the picture. */
async function imageSize(blob: Blob): Promise<{width: number; height: number} | null> {
  const b = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
  if (b.byteLength > 24 && b.getUint32(0) === 0x89504e47) return {width: b.getUint32(16), height: b.getUint32(20)};
  if (b.getUint16(0) === 0xffd8) {
    let o = 2;
    while (o + 9 < b.byteLength) {
      if (b.getUint8(o) !== 0xff) return null;
      const marker = b.getUint8(o + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return {height: b.getUint16(o + 5), width: b.getUint16(o + 7)};
      o += 2 + b.getUint16(o + 2);
    }
  }
  return null;
}

class Cancelled extends Error {}

async function runJob(job: WorkerJob, signal: AbortSignal): Promise<void> {
  const api = window.mediaWorker;
  const check = () => {
    if (signal.aborted) throw new Cancelled("cancelled");
  };
  const progress = (stage: Stage, fraction: number) => void api.progress(job.jobId, stage, fraction);
  const writeFile = async (kind: string, data: Uint8Array) => {
    // Chunked, so one message never exceeds the limit main enforces.
    for (let o = 0; o < data.byteLength; o += FLUSH_BYTES) await api.writeAt(job.jobId, kind, o, data.subarray(o, o + FLUSH_BYTES));
    await api.commit(job.jobId, kind);
  };
  const jpeg = async (canvas: HTMLCanvasElement, quality: number) =>
    new Uint8Array(await (await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", quality))).arrayBuffer());

  if (job.type === "image") {
    const blob = await (await fetch(job.srcUrl)).blob();
    // Refuse a huge picture before decoding it: 20000x20000 pixels would need 1.6GB.
    const size = await imageSize(blob);
    if (!size || size.width * size.height > MAX_IMAGE_PIXELS) throw new Error("Image is too large to import (over 50 megapixels).");
    const bitmap = await createImageBitmap(blob);
    const meta: MediaMeta = {width: bitmap.width, height: bitmap.height, rotation: 0};
    await api.meta(job.jobId, meta);
    if (job.needs.thumb) {
      const scale = Math.min(1, THUMB_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement("canvas");
      c.width = even(bitmap.width * scale);
      c.height = even(bitmap.height * scale);
      c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
      await writeFile("thumb.jpg", await jpeg(c, 0.8));
    }
    bitmap.close();
    return;
  }

  const input = new Input({source: new UrlSource(job.srcUrl), formats: ALL_FORMATS});
  try {
    const video = job.type === "video" ? await input.getPrimaryVideoTrack() : null;
    const audio = await input.getPrimaryAudioTrack();
    const durationS = await input.computeDuration();
    if (!(durationS > 0) || durationS > MAX_DURATION_S) throw new Error("Unsupported duration (more than 12 hours, or unreadable).");
    let packetFps: number | undefined;
    let hdr: boolean | undefined;
    if (video) {
      packetFps = (await video.computePacketStats(120)).averagePacketRate;
      hdr = await video.hasHighDynamicRange();
    }
    const meta: MediaMeta = {
      durationUs: Math.round(durationS * 1e6),
      fps: packetFps ? Math.round(packetFps * 100) / 100 : undefined,
      width: video?.displayWidth,
      height: video?.displayHeight,
      rotation: video?.rotation ?? 0,
      codec: video?.codec ?? audio?.codec ?? undefined,
      audioChannels: audio?.numberOfChannels ?? 0,
      hdr,
    };
    await api.meta(job.jobId, meta);
    check();

    // Poster thumbnail and filmstrip first: they are quick and make the asset look ready while the proxy encodes.
    if (video && (job.needs.thumb || job.needs.filmstrip)) {
      progress("thumbs", 0);
      await thumbnails(video, durationS, job, writeFile, jpeg, check);
      progress("thumbs", 1);
    }
    check();

    if (video && job.needs.proxy) {
      const {width, height} = proxySize(video.displayWidth, video.displayHeight);
      const writable = coalescingWritable((pos, data) => api.writeAt(job.jobId, "proxy.mp4", pos, data));
      const output = new Output({format: new Mp4OutputFormat(), target: new StreamTarget(writable, {chunked: true, chunkSize: 4 * 1024 * 1024})});
      const conversion = await Conversion.init({
        input,
        output,
        video: {width, height, fit: "fill", frameRate: proxyFps(packetFps), codec: "avc", bitrate: PROXY_BITRATE},
      });
      if (!conversion.isValid) throw new Error(`Cannot make a proxy: ${conversion.discardedTracks.map((d) => `${d.track.type} ${d.reason}`).join(", ")}`);
      conversion.onProgress = (p) => progress("proxy", p);
      signal.addEventListener("abort", () => void conversion.cancel(), {once: true});
      progress("proxy", 0);
      await conversion.execute().catch((e) => {
        if (signal.aborted) throw new Cancelled("cancelled");
        throw e;
      });
      check();
      await api.commit(job.jobId, "proxy.mp4");
    }

    if (audio && job.needs.peaks) {
      progress("peaks", 0);
      await writeFile("peaks", await audioPeaks(audio, durationS, check));
      progress("peaks", 1);
    } else if (job.needs.peaks) {
      await api.commit(job.jobId, "peaks"); // no audio: an empty file records that nothing is left to do
    }
  } finally {
    input.dispose();
  }
}

async function thumbnails(
  track: InputVideoTrack,
  durationS: number,
  job: WorkerJob,
  writeFile: (kind: string, data: Uint8Array) => Promise<void>,
  jpeg: (c: HTMLCanvasElement, q: number) => Promise<Uint8Array>,
  check: () => void,
): Promise<void> {
  if (job.needs.thumb) {
    const scale = THUMB_LONG_SIDE / Math.max(track.displayWidth, track.displayHeight);
    const w = even(track.displayWidth * scale);
    const h = even(track.displayHeight * scale);
    const sink = new CanvasSink(track, {width: w, height: h, fit: "fill"});
    const wrapped = await sink.getCanvas(Math.min(durationS * 0.1, Math.max(0, durationS - 0.1)));
    if (wrapped) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, w, h);
      await writeFile("thumb.jpg", await jpeg(c, 0.8));
    }
  }
  check();
  if (job.needs.filmstrip) {
    const sink = new CanvasSink(track, {width: TILE_W, height: TILE_H, fit: "cover"});
    const sprite = document.createElement("canvas");
    sprite.width = TILE_W * FILMSTRIP_TILES;
    sprite.height = TILE_H;
    const ctx = sprite.getContext("2d")!;
    for (let i = 0; i < FILMSTRIP_TILES; i++) {
      check();
      const wrapped = await sink.getCanvas((durationS * i) / FILMSTRIP_TILES);
      if (wrapped) ctx.drawImage(wrapped.canvas as CanvasImageSource, i * TILE_W, 0);
    }
    await writeFile("filmstrip.jpg", await jpeg(sprite, 0.7));
  }
}

/** Max absolute sample per 10ms across channels, quantised to 8 bits. */
async function audioPeaks(track: NonNullable<Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>>, durationS: number, check: () => void): Promise<Uint8Array> {
  const sink = new AudioSampleSink(track);
  const peaks = new Uint8Array(Math.ceil(durationS / PEAK_WINDOW_S) + 2);
  for await (const sample of sink.samples()) {
    check();
    const n = sample.numberOfFrames;
    const planes: Float32Array[] = [];
    for (let c = 0; c < sample.numberOfChannels; c++) {
      const buf = new Float32Array(n);
      sample.copyTo(buf, {planeIndex: c, format: "f32-planar"});
      planes.push(buf);
    }
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (const plane of planes) m = Math.max(m, Math.abs(plane[i]!));
      const idx = Math.floor((sample.timestamp + i / sample.sampleRate) / PEAK_WINDOW_S);
      if (idx >= 0 && idx < peaks.length) peaks[idx] = Math.max(peaks[idx]!, Math.min(255, Math.round(m * 255)));
    }
    sample.close();
  }
  return peaks;
}

export function startMediaWorker(): void {
  const api = window.mediaWorker;
  const aborts = new Map<string, AbortController>();
  api.onCancel((jobId) => aborts.get(jobId)?.abort());
  api.onJob((job) => {
    const abort = new AbortController();
    aborts.set(job.jobId, abort);
    runJob(job, abort.signal)
      .then(() => api.done(job.jobId))
      .catch((err) => api.done(job.jobId, err instanceof Cancelled ? "cancelled" : String(err instanceof Error ? err.message : err).slice(0, 1500)))
      .finally(() => aborts.delete(job.jobId));
  });
  void api.ready();
}
