// Preload for the hidden export render window only. It receives one job from main and can report progress, write the
// output file for that job and finish it; it has no access to projects, dialogs or paths.
import {contextBridge, ipcRenderer} from "electron";
import {IPC, type RenderJob} from "./ipc";

export type RenderApi = {
  onJob: (listener: (job: RenderJob) => void) => void;
  onCancel: (listener: (jobId: string) => void) => void;
  ready: () => Promise<void>;
  progress: (jobId: string, fraction: number) => Promise<void>;
  write: (jobId: string, position: number, data: Uint8Array) => Promise<void>;
  done: (jobId: string, error?: string) => Promise<void>;
};

const api: RenderApi = {
  onJob: (listener) => void ipcRenderer.on(IPC.render.job, (_e, job: RenderJob) => listener(job)),
  onCancel: (listener) => void ipcRenderer.on(IPC.render.cancel, (_e, jobId: string) => listener(jobId)),
  ready: () => ipcRenderer.invoke(IPC.render.ready),
  progress: (jobId, fraction) => ipcRenderer.invoke(IPC.render.progress, {jobId, fraction}),
  write: (jobId, position, data) => ipcRenderer.invoke(IPC.render.write, {jobId, position, data}),
  done: (jobId, error) => ipcRenderer.invoke(IPC.render.done, {jobId, error}),
};

contextBridge.exposeInMainWorld("renderWindow", api);
