// Main-process side of media processing. Owns the job queue (one job at a time, for the 8GB target) and a hidden
// worker window that runs Mediabunny (WebCodecs is not available in Node). The worker can only report results and write
// derived files for the job it was given; every path is chosen here from a validated hash.
import {assetFile, cacheFile, fileExists, sweepPartials, type CacheKind} from "@studio/project-store";
import {BrowserWindow, ipcMain, type IpcMainInvokeEvent} from "electron";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {IPC, WorkerReq, type MediaEvent, type MediaMeta, type WorkerJob} from "./ipc";
import {mediaUrl} from "./media-protocol";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export type QueueItem = {projectId: string; sha256: string; ext: string; type: WorkerJob["type"]; metaMissing: boolean};
type Running = QueueItem & {jobId: string; dir: string; handles: Map<CacheKind, Promise<fs.FileHandle>>; touch: number; cancelled: boolean; finish: (error?: string) => void};

const IDLE_CLOSE_MS = 20_000;
const WORKER_START_MS = 30_000;
/** A job that reports nothing (no progress, no write) for this long is treated as hung. Encoding reports at least every few seconds. */
const JOB_SILENCE_MS = 120_000;

export class MediaService {
  private queue: QueueItem[] = [];
  private running: Running | null = null;
  private runEnded: Promise<void> | null = null;
  private busy = false; // set synchronously, so two enqueues can never start two jobs
  private worker: BrowserWindow | null = null;
  private workerReady: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: {
      projectDir: (projectId: string) => string;
      emit: (e: MediaEvent) => void;
      /** Called after a thumbnail is written, so main can use the first one as the project thumbnail. */
      onThumb?: (projectId: string, thumbFile: string) => void;
    },
  ) {
    const only = <S extends keyof typeof WorkerReq>(channel: string, key: S, fn: (m: ReturnType<(typeof WorkerReq)[S]["parse"]>) => unknown) =>
      ipcMain.handle(channel, (event, raw: unknown) => {
        this.assertWorker(event);
        return fn(WorkerReq[key].parse(raw) as never);
      });
    ipcMain.handle(IPC.worker.ready, (event) => {
      this.assertWorker(event);
      this.readyResolve?.();
    });
    only(IPC.worker.meta, "meta", (m: {jobId: string; meta: MediaMeta}) => {
      const r = this.current(m.jobId);
      if (r.cancelled) return;
      this.opts.emit({kind: "meta", projectId: r.projectId, sha256: r.sha256, meta: m.meta});
    });
    only(IPC.worker.progress, "progress", (m: {jobId: string; stage: "meta" | "proxy" | "thumbs" | "peaks"; fraction: number}) => {
      const r = this.current(m.jobId);
      this.opts.emit({kind: "progress", projectId: r.projectId, sha256: r.sha256, stage: m.stage, fraction: m.fraction});
    });
    only(IPC.worker.writeAt, "writeAt", async (m: {jobId: string; kind: CacheKind; position: number; data: Uint8Array}) => {
      const r = this.current(m.jobId);
      if (r.cancelled) throw new Error("Job was cancelled.");
      // The open is stored as a promise before it is awaited, so two writes for one file can never open it twice.
      let open = r.handles.get(m.kind);
      if (!open) {
        open = this.openPart(r, m.kind);
        r.handles.set(m.kind, open);
      }
      const h = await open;
      await h.write(m.data, 0, m.data.byteLength, m.position);
    });
    only(IPC.worker.commit, "commit", async (m: {jobId: string; kind: CacheKind}) => {
      const r = this.current(m.jobId);
      if (r.cancelled) throw new Error("Job was cancelled.");
      const final = cacheFile(r.dir, r.sha256, m.kind);
      // Nothing written yet: an empty file (for example the peaks of a silent clip).
      const open = r.handles.get(m.kind) ?? this.openPart(r, m.kind);
      const h = await open;
      await h.sync();
      await h.close();
      r.handles.delete(m.kind);
      await fs.rename(`${final}.part`, final);
      if (m.kind === "thumb.jpg") this.opts.onThumb?.(r.projectId, final);
    });
    only(IPC.worker.done, "done", (m: {jobId: string; error?: string}) => {
      this.current(m.jobId).finish(m.error);
    });
  }

  private async openPart(r: Running, kind: CacheKind): Promise<fs.FileHandle> {
    // Not recursive: a project folder that was deleted meanwhile must not be recreated by a late write.
    await fs.mkdir(path.join(r.dir, "cache")).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    return fs.open(`${cacheFile(r.dir, r.sha256, kind)}.part`, "w");
  }

  private assertWorker(event: IpcMainInvokeEvent): void {
    if (!this.worker || event.sender.id !== this.worker.webContents.id || event.senderFrame !== this.worker.webContents.mainFrame) {
      throw new Error("Blocked IPC call from an untrusted sender.");
    }
  }

  private current(jobId: string): Running {
    if (!this.running || this.running.jobId !== jobId) throw new Error("No such job.");
    this.running.touch = Date.now();
    return this.running;
  }

  /** Queue an asset (idempotent: an asset already queued or running is not added twice). */
  enqueue(item: QueueItem): void {
    const same = (q: QueueItem) => q.projectId === item.projectId && q.sha256 === item.sha256;
    if (this.queue.some(same) || (this.running && !this.running.cancelled && same(this.running))) return;
    this.queue.push(item);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    void this.pump();
  }

  cancel(projectId: string, sha256?: string): void {
    const hit = (q: QueueItem) => q.projectId === projectId && (!sha256 || q.sha256 === sha256);
    for (const q of this.queue.filter(hit)) this.opts.emit({kind: "cancelled", projectId, sha256: q.sha256});
    this.queue = this.queue.filter((q) => !hit(q));
    if (this.running && hit(this.running)) {
      this.running.cancelled = true;
      this.worker?.webContents.send(IPC.worker.cancel, this.running.jobId);
    }
  }

  /** Cancel, then resolve once the running job (if it was the target) has fully stopped and closed its files. */
  async cancelAndWait(projectId: string, sha256?: string): Promise<void> {
    const target = this.running && this.running.projectId === projectId && (!sha256 || this.running.sha256 === sha256) ? this.runEnded : null;
    this.cancel(projectId, sha256);
    await target;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const item = this.queue.shift();
    if (!item) {
      this.idleTimer = setTimeout(() => this.closeWorker(), IDLE_CLOSE_MS);
      return;
    }
    this.busy = true;
    let ended!: () => void;
    this.runEnded = new Promise<void>((resolve) => (ended = resolve));
    try {
      await this.run(item);
    } catch (err) {
      this.opts.emit({kind: "error", projectId: item.projectId, sha256: item.sha256, message: err instanceof Error ? err.message : String(err)});
    } finally {
      this.running = null;
      this.busy = false;
      this.runEnded = null;
      ended();
      void this.pump();
    }
  }

  private async neededFiles(dir: string, item: QueueItem): Promise<WorkerJob["needs"]> {
    const lacks = async (kind: CacheKind) => !(await fileExists(cacheFile(dir, item.sha256, kind)));
    const v = item.type === "video";
    return {
      proxy: v && (await lacks("proxy.mp4")),
      thumb: item.type !== "audio" && (await lacks("thumb.jpg")),
      filmstrip: v && (await lacks("filmstrip.jpg")),
      peaks: item.type !== "image" && (await lacks("peaks")),
    };
  }

  private async run(item: QueueItem): Promise<void> {
    const dir = this.opts.projectDir(item.projectId);
    const src = assetFile(dir, item.sha256, item.ext);
    if (!(await fileExists(src))) throw new Error("Source file is missing.");
    const needs = await this.neededFiles(dir, item);
    if (!item.metaMissing && !Object.values(needs).some(Boolean)) {
      this.opts.emit({kind: "done", projectId: item.projectId, sha256: item.sha256});
      return;
    }
    const jobId = randomUUID();
    // Registered before any await so a cancel that arrives while the worker starts is not lost.
    const finished = new Promise<string | undefined>((resolve) => {
      this.running = {...item, jobId, dir, handles: new Map(), touch: Date.now(), cancelled: false, finish: resolve};
    });
    let watchdog: ReturnType<typeof setInterval> | undefined;
    try {
      await sweepPartials(dir);
      await this.ensureWorker();
      if (this.running?.cancelled) {
        this.opts.emit({kind: "cancelled", projectId: item.projectId, sha256: item.sha256});
        return;
      }
      // Hung worker: no message for JOB_SILENCE_MS fails the job and replaces the window.
      watchdog = setInterval(() => {
        if (this.running && Date.now() - this.running.touch > JOB_SILENCE_MS) this.running.finish("Media worker stopped responding.");
      }, 5_000);
      this.worker!.webContents.send(IPC.worker.job, {jobId, sha256: item.sha256, type: item.type, srcUrl: mediaUrl(src), needs} satisfies WorkerJob);
      const error = await finished;
      const r = this.running as Running | null;
      for (const h of r?.handles.values() ?? []) await h.then((x) => x.close()).catch(() => undefined);
      r?.handles.clear();
      await sweepPartials(dir);
      if (error && !r?.cancelled) {
        if (error.startsWith("Media worker stopped")) this.closeWorker(); // whatever state it is in, start the next job on a fresh one
        throw new Error(error);
      }
      this.opts.emit(r?.cancelled ? {kind: "cancelled", projectId: item.projectId, sha256: item.sha256} : {kind: "done", projectId: item.projectId, sha256: item.sha256});
    } finally {
      clearInterval(watchdog);
    }
  }

  private ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return this.workerReady;
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false, // encoding must not slow down when the window is hidden
        preload: path.join(__dirname, "worker-preload.js"),
      },
    });
    this.worker = win;
    win.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning") console.log(`[media-worker] ${e.message}`);
    });
    win.on("closed", () => {
      if (this.worker === win) this.worker = this.workerReady = null;
    });
    // One listener for the window's whole life: a crash ends whichever job is running.
    win.webContents.on("render-process-gone", (_e, d) => {
      this.running?.finish(`Media worker stopped (${d.reason}).`);
      this.readyReject?.(new Error("Media worker stopped while starting."));
    });
    win.webContents.on("did-fail-load", () => this.readyReject?.(new Error("Media worker failed to load.")));
    this.workerReady = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      setTimeout(() => reject(new Error("Media worker did not start.")), WORKER_START_MS);
    });
    this.workerReady.catch(() => this.closeWorker()); // the next job starts a fresh window
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?worker=media`);
    else void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {query: {worker: "media"}});
    return this.workerReady;
  }

  closeWorker(): void {
    this.running?.finish("Media worker stopped (window closed).");
    const w = this.worker;
    this.worker = this.workerReady = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  /** Stop everything (app quitting). */
  shutdown(): void {
    this.queue = [];
    this.closeWorker();
  }
}
