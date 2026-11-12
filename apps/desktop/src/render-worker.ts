// Runs in the hidden render window (loaded with ?worker=render). For the one job main sends it, it renders the project
// composition with the web renderer in "export" mode (the original files, not proxies) and streams the MP4 to main over
// IPC, so the file is never assembled in memory. Main destroys this window after every export, which hands the decoder
// and encoder memory back to the OS.
import {renderMediaOnWeb} from "@remotion/web-renderer";
import {EXPORT_BITRATE} from "./export-settings";
import {loadBundledFonts} from "./engine/fonts";
import {ProjectComposition, type EngineProps} from "./engine/ProjectComposition";
import type {RenderJob} from "./ipc";
import {coalescingWritable} from "./media-worker";
import type {RenderApi} from "./render-preload";

declare global {
  interface Window {
    renderWindow: RenderApi;
  }
}

/** The plan's budget for the render window's decoded-frame cache (the editor's is 240MB). Read on first use. */
const RENDER_CACHE_BYTES = 300 * 1024 * 1024;
const PROGRESS_EVERY_MS = 250;

async function runJob(job: RenderJob, signal: AbortSignal): Promise<void> {
  const api = window.renderWindow;
  (window as unknown as {remotion_mediaCacheSizeInBytes: number}).remotion_mediaCacheSizeInBytes = RENDER_CACHE_BYTES;
  await loadBundledFonts();
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");

  const writable = coalescingWritable((position, data) => api.write(job.jobId, position, data));
  let last = 0;
  await renderMediaOnWeb({
    composition: {
      id: "studio-export",
      component: ProjectComposition,
      durationInFrames: job.totalFrames,
      fps: job.project.fps,
      width: job.project.width,
      height: job.project.height,
      defaultProps: {project: job.project, mode: "export", baseUrl: job.baseUrl} satisfies EngineProps,
    },
    inputProps: {project: job.project, mode: "export", baseUrl: job.baseUrl} satisfies EngineProps,
    scale: job.scale,
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    videoBitrate: EXPORT_BITRATE[job.height],
    outputWritable: writable,
    signal,
    // Remotion's Free License (https://remotion.dev/license). The library still tries its usage ping to remotion.pro;
    // the CSP's connect-src blocks it, so nothing leaves the machine.
    licenseKey: "free-license",
    onProgress: ({encodedFrames}: {encodedFrames: number}) => {
      const now = Date.now();
      if (now - last < PROGRESS_EVERY_MS) return;
      last = now;
      void api.progress(job.jobId, Math.min(1, encodedFrames / Math.max(1, job.totalFrames)));
    },
  });
}

export function startRenderWindow(): void {
  const api = window.renderWindow;
  const aborts = new Map<string, AbortController>();
  api.onCancel((jobId) => aborts.get(jobId)?.abort());
  api.onJob((job) => {
    const abort = new AbortController();
    aborts.set(job.jobId, abort);
    runJob(job, abort.signal)
      .then(() => api.done(job.jobId))
      .catch((err) => {
        const cancelled = abort.signal.aborted || (err instanceof Error && /cancel|abort/i.test(`${err.name} ${err.message}`));
        return api.done(job.jobId, cancelled ? "cancelled" : String(err instanceof Error ? err.message : err).slice(0, 1500));
      })
      .finally(() => aborts.delete(job.jobId));
  });
  void api.ready();
}
