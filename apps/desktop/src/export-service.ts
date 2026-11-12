// Main-process side of export (M6). Owns the one running export and the hidden render window that runs the web
// renderer. The renderer process only says which project and which size: main reads the project from disk, asks for
// the destination in a native save dialog, writes the chunks the render window sends to `<file>.part`, and renames it
// into place only when the render succeeded. The window is destroyed after every export, whatever the outcome.
import {addExport, exportLogFile, fileExists, readExports, type ProjectStore} from "@studio/project-store";
import {exportFileName, exportSize, nextExportVersion, projectDurationFrames, type ExportHeight, type ExportRecord} from "@studio/schema";
import {BrowserWindow, ipcMain, type IpcMainInvokeEvent} from "electron";
import {randomUUID} from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {IPC, RenderReq, type ExportEvent, type ExportStart, type RenderJob} from "./ipc";
import {mediaUrl} from "./media-protocol";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const WINDOW_START_MS = 30_000;
/** No message from the render window for this long (progress is sent several times a second) means it is hung. */
const SILENCE_MS = 120_000;
/** After a cancel the renderer gets this long to stop by itself before its window is destroyed. */
const CANCEL_GRACE_MS = 10_000;
const LOG_PROGRESS_STEP = 0.1;

type Running = {
  exportId: string;
  projectId: string;
  jobId: string;
  dest: string;
  part: string;
  handle: fs.FileHandle | null;
  startedAt: number;
  touch: number;
  cancelled: boolean;
  finish: (error?: string) => void;
};

export type ExportServiceOptions = {
  store: ProjectStore;
  emit: (e: ExportEvent) => void;
  /** Native save dialog (stubbed in end-to-end runs). Null when cancelled. */
  pickSavePath: (suggestedName: string) => Promise<string | null>;
};

export class ExportService {
  private running: Running | null = null;
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private logFile: string | null = null;
  private logChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ExportServiceOptions) {
    const only = <S extends keyof typeof RenderReq>(channel: string, key: S, fn: (m: ReturnType<(typeof RenderReq)[S]["parse"]>) => unknown) =>
      ipcMain.handle(channel, (event, raw: unknown) => {
        this.assertWindow(event);
        return fn(RenderReq[key].parse(raw) as never);
      });
    ipcMain.handle(IPC.render.ready, (event) => {
      this.assertWindow(event);
      this.readyResolve?.();
    });
    only(IPC.render.progress, "progress", (m: {jobId: string; fraction: number}) => {
      const r = this.current(m.jobId);
      if (r.cancelled) return;
      const elapsedMs = Date.now() - r.startedAt;
      this.opts.emit({kind: "progress", exportId: r.exportId, projectId: r.projectId, fraction: m.fraction, elapsedMs, etaMs: m.fraction >= 0.02 ? Math.round((elapsedMs / m.fraction) * (1 - m.fraction)) : null});
      const step = Math.floor(m.fraction / LOG_PROGRESS_STEP);
      if (step > this.loggedStep) {
        this.loggedStep = step;
        this.log(`progress ${Math.round(m.fraction * 100)}%`);
      }
    });
    only(IPC.render.write, "write", async (m: {jobId: string; position: number; data: Uint8Array}) => {
      const r = this.current(m.jobId);
      if (r.cancelled || !r.handle) throw new Error("Export was cancelled.");
      await r.handle.write(m.data, 0, m.data.byteLength, m.position);
    });
    only(IPC.render.done, "done", (m: {jobId: string; error?: string}) => this.current(m.jobId).finish(m.error));
  }

  private loggedStep = 0;

  private assertWindow(event: IpcMainInvokeEvent): void {
    if (!this.win || this.win.isDestroyed() || event.sender.id !== this.win.webContents.id || event.senderFrame !== this.win.webContents.mainFrame) {
      throw new Error("Blocked IPC call from an untrusted sender.");
    }
  }

  private current(jobId: string): Running {
    if (!this.running || this.running.jobId !== jobId) throw new Error("No such export.");
    this.running.touch = Date.now();
    return this.running;
  }

  private log(message: string): void {
    const file = this.logFile;
    if (!file) return;
    this.logChain = this.logChain.then(() => fs.appendFile(file, `${new Date().toISOString()} ${message}\n`)).catch(() => undefined);
  }

  async list(projectId: string): Promise<ExportRecord[]> {
    return readExports(this.opts.store.dir(projectId));
  }

  /**
   * Ask for a destination, then start. Resolves as soon as the render is under way (or with null if the dialog was
   * cancelled); progress and the result come as events. Rejects, with a message the user can read, if the export cannot begin.
   */
  async start(projectId: string, height: ExportHeight): Promise<ExportStart | null> {
    if (this.running) throw new Error("An export is already running.");
    const {store} = this.opts;
    const dir = store.dir(projectId);
    const {project} = await store.open(projectId);
    const totalFrames = projectDurationFrames(project);
    if (totalFrames === 0) throw new Error("The timeline is empty. Add something to export.");
    await this.checkMedia(dir, project);

    const version = nextExportVersion(await readExports(dir));
    const picked = await this.opts.pickSavePath(exportFileName(project.name, version));
    if (!picked) return null;
    if (this.running) throw new Error("An export is already running."); // another start answered its dialog first
    const dest = path.extname(picked).toLowerCase() === ".mp4" ? picked : `${picked}.mp4`;
    // Never write into the app's own project folders: a chosen name like project.json would replace a project.
    const rel = path.relative(store.root, path.resolve(dest));
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("Choose a folder outside Studio's project storage.");

    const exportId = randomUUID();
    const jobId = randomUUID();
    const size = exportSize(project.width, project.height, height);
    const startedAt = Date.now();
    const part = `${dest}.part`;
    let finish!: (error?: string) => void;
    const finished = new Promise<string | undefined>((resolve) => (finish = resolve));
    const run: Running = {exportId, projectId, jobId, dest, part, handle: null, startedAt, touch: Date.now(), cancelled: false, finish};
    this.running = run; // set before any await, so a second start cannot slip in
    this.loggedStep = 0;
    try {
      await fs.mkdir(path.join(dir, "exports"), {recursive: true});
      run.handle = await fs.open(part, "w"); // fails here, with the OS message, if the folder cannot be written
    } catch (err) {
      this.running = null;
      throw err;
    }
    this.logFile = exportLogFile(dir, exportId);
    this.log(`start "${project.name}" ${project.width}x${project.height} -> ${size.width}x${size.height} (${height}p), ${project.fps} fps, ${totalFrames} frames`);
    this.log(`destination ${dest}`);

    const job: RenderJob = {jobId, project, baseUrl: mediaUrl(dir), totalFrames, width: size.width, height, scale: size.scale};
    void this.drive(run, job, finished, {dir, height, size, totalFrames, version});
    return {exportId, fileName: path.basename(dest)};
  }

  /** Check every original the timeline plays is on disk, so a missing file is named up front, not as a render error. */
  private async checkMedia(dir: string, project: Awaited<ReturnType<ProjectStore["open"]>>["project"]): Promise<void> {
    const used = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)).filter((a): a is string => !!a));
    const missing: string[] = [];
    for (const a of project.assets) {
      if (!used.has(a.id)) continue;
      const file = path.resolve(dir, a.relativePath);
      if (path.relative(dir, file).startsWith("..") || !(await fileExists(file))) missing.push(a.name ?? a.relativePath);
    }
    if (missing.length) throw new Error(`These files are missing, so the video cannot be exported: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}. Relink them in the media panel.`);
  }

  private async drive(run: Running, job: RenderJob, finished: Promise<string | undefined>, ctx: {dir: string; height: ExportHeight; size: {width: number; height: number}; totalFrames: number; version: number}): Promise<void> {
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let error: string | undefined;
    try {
      await this.ensureWindow();
      if (!run.cancelled) {
        watchdog = setInterval(() => {
          if (Date.now() - run.touch > SILENCE_MS) run.finish("The render window stopped responding.");
        }, 5_000);
        this.win!.webContents.send(IPC.render.job, job);
      } else {
        run.finish("cancelled");
      }
      error = await finished;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearInterval(watchdog);
    }
    const cancelled = run.cancelled || error === "cancelled";
    let status: ExportRecord["status"] = cancelled ? "cancelled" : error ? "failed" : "done";
    let message = cancelled ? undefined : error;
    let sizeBytes = 0;
    try {
      await run.handle?.sync().catch(() => undefined);
      await run.handle?.close();
      run.handle = null;
      if (status === "done") {
        await fs.rename(run.part, run.dest);
        sizeBytes = (await fs.stat(run.dest)).size;
      } else {
        await fs.rm(run.part, {force: true});
      }
    } catch (err) {
      status = "failed";
      message = `Could not save the file: ${err instanceof Error ? err.message : String(err)}`;
      await fs.rm(run.part, {force: true}).catch(() => undefined);
    }
    this.destroyWindow(); // decoder and encoder memory goes back to the OS
    const elapsedMs = Date.now() - run.startedAt;
    this.log(`${status}${message ? `: ${message}` : ""} after ${(elapsedMs / 1000).toFixed(1)}s${sizeBytes ? `, ${sizeBytes} bytes` : ""}`);
    await this.logChain;
    const record: ExportRecord = {
      id: run.exportId,
      version: ctx.version,
      fileName: path.basename(run.dest),
      path: run.dest,
      height: ctx.height,
      width: ctx.size.width,
      outputHeight: ctx.size.height,
      fps: job.project.fps,
      durationFrames: ctx.totalFrames,
      sizeBytes,
      startedAt: new Date(run.startedAt).toISOString(),
      elapsedMs,
      status,
      ...(message ? {error: message.slice(0, 2000)} : {}),
    };
    await addExport(ctx.dir, record).catch((err) => console.error("[export] could not write history", err));
    this.running = null;
    this.logFile = null;
    this.opts.emit({kind: "finished", exportId: run.exportId, projectId: run.projectId, record});
  }

  cancel(exportId: string): void {
    const r = this.running;
    if (!r || r.exportId !== exportId || r.cancelled) return;
    r.cancelled = true;
    this.log("cancel requested");
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.render.cancel, r.jobId);
    // A renderer that does not stop is not waited for: its window is destroyed, which ends the job.
    setTimeout(() => this.running === r && r.finish("cancelled"), CANCEL_GRACE_MS);
    if (!this.win) r.finish("cancelled");
  }

  private ensureWindow(): Promise<void> {
    if (this.win && this.ready) return this.ready;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // rendering must not slow down when the window is hidden
        preload: path.join(__dirname, "render-preload.js"),
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning") this.log(`[render window] ${e.level}: ${e.message}`);
    });
    win.on("closed", () => {
      if (this.win === win) this.win = this.ready = null;
    });
    win.webContents.on("render-process-gone", (_e, d) => {
      this.running?.finish(`The render window stopped (${d.reason}).`);
      this.readyReject?.(new Error("The render window stopped while starting."));
    });
    win.webContents.on("did-fail-load", () => this.readyReject?.(new Error("The render window failed to load.")));
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      setTimeout(() => reject(new Error("The render window did not start.")), WINDOW_START_MS);
    });
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?worker=render`);
    else void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {query: {worker: "render"}});
    return this.ready;
  }

  private destroyWindow(): void {
    const w = this.win;
    this.win = this.ready = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  /** App quitting: stop the render and remove the partial file. */
  shutdown(): void {
    const r = this.running;
    if (r) {
      r.cancelled = true;
      void r.handle?.close().catch(() => undefined);
      r.handle = null;
      try {
        // synchronous on purpose: the process is about to exit
        fsSync.rmSync(r.part, {force: true});
      } catch {
        /* nothing more to do */
      }
    }
    this.destroyWindow();
  }
}
