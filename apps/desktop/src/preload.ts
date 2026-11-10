import {contextBridge, ipcRenderer} from "electron";
import {IPC, type MemoryMetrics, type StudioApi} from "./ipc";

const on = (channel: string, listener: (...args: never[]) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => (listener as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: StudioApi = {
  openMedia: () => ipcRenderer.invoke(IPC.openMedia),
  onMetrics: (listener) => on(IPC.metrics, (m: MemoryMetrics) => listener(m)),
  onFlushRequest: (listener) => on(IPC.flushRequest, () => listener()),
  flushDone: () => ipcRenderer.invoke(IPC.flushDone),
  projects: {
    list: () => ipcRenderer.invoke(IPC.projects.list),
    create: (req) => ipcRenderer.invoke(IPC.projects.create, req),
    open: (id) => ipcRenderer.invoke(IPC.projects.open, {id}),
    save: (project) => ipcRenderer.invoke(IPC.projects.save, {project}),
    rename: (id, name) => ipcRenderer.invoke(IPC.projects.rename, {id, name}),
    duplicate: (id, fps) => ipcRenderer.invoke(IPC.projects.duplicate, {id, fps}),
    remove: (id) => ipcRenderer.invoke(IPC.projects.remove, {id}),
    setThumbnail: (id, jpeg) => ipcRenderer.invoke(IPC.projects.setThumbnail, {id, jpeg}),
  },
};

contextBridge.exposeInMainWorld("studio", api);
