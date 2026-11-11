// Preload for the hidden media worker window only. It can report results and write derived files for the job main
// gave it; it has no access to projects, dialogs or arbitrary paths.
import {contextBridge, ipcRenderer} from "electron";
import {IPC, type MediaMeta, type Stage, type WorkerJob} from "./ipc";

export type WorkerApi = {
  onJob: (listener: (job: WorkerJob) => void) => void;
  onCancel: (listener: (jobId: string) => void) => void;
  ready: () => Promise<void>;
  meta: (jobId: string, meta: MediaMeta) => Promise<void>;
  progress: (jobId: string, stage: Stage, fraction: number) => Promise<void>;
  writeAt: (jobId: string, kind: string, position: number, data: Uint8Array) => Promise<void>;
  commit: (jobId: string, kind: string) => Promise<void>;
  done: (jobId: string, error?: string) => Promise<void>;
};

const api: WorkerApi = {
  onJob: (listener) => void ipcRenderer.on(IPC.worker.job, (_e, job: WorkerJob) => listener(job)),
  onCancel: (listener) => void ipcRenderer.on(IPC.worker.cancel, (_e, jobId: string) => listener(jobId)),
  ready: () => ipcRenderer.invoke(IPC.worker.ready),
  meta: (jobId, meta) => ipcRenderer.invoke(IPC.worker.meta, {jobId, meta}),
  progress: (jobId, stage, fraction) => ipcRenderer.invoke(IPC.worker.progress, {jobId, stage, fraction}),
  writeAt: (jobId, kind, position, data) => ipcRenderer.invoke(IPC.worker.writeAt, {jobId, kind, position, data}),
  commit: (jobId, kind) => ipcRenderer.invoke(IPC.worker.commit, {jobId, kind}),
  done: (jobId, error) => ipcRenderer.invoke(IPC.worker.done, {jobId, error}),
};

contextBridge.exposeInMainWorld("mediaWorker", api);
