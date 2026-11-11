import {contextBridge, ipcRenderer, webUtils} from "electron";
import {IPC, type MediaEvent, type MemoryMetrics, type StudioApi} from "./ipc";

const on = (channel: string, listener: (...args: never[]) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => (listener as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: StudioApi = {
  isE2E: process.argv.includes("--studio-e2e"),
  openMedia: () => ipcRenderer.invoke(IPC.openMedia),
  onMetrics: (listener) => on(IPC.metrics, (m: MemoryMetrics) => listener(m)),
  onFlushRequest: (listener) => on(IPC.flushRequest, () => listener()),
  flushDone: () => ipcRenderer.invoke(IPC.flushDone),
  media: {
    import: (projectId) => ipcRenderer.invoke(IPC.media.import, {projectId}),
    importPaths: (projectId, paths) => ipcRenderer.invoke(IPC.media.importPaths, {projectId, paths}),
    relink: (projectId, sha256, type) => ipcRenderer.invoke(IPC.media.relink, {projectId, sha256, type}),
    ensure: (projectId, items) => ipcRenderer.invoke(IPC.media.ensure, {projectId, items}),
    cancel: (projectId, sha256) => ipcRenderer.invoke(IPC.media.cancel, {projectId, sha256}),
    readPeaks: (projectId, sha256) => ipcRenderer.invoke(IPC.media.readPeaks, {projectId, sha256}),
    deleteAssets: (projectId, items) => ipcRenderer.invoke(IPC.media.deleteAssets, {projectId, items}),
    onEvent: (listener) => on(IPC.media.event, (e: MediaEvent) => listener(e)),
    pathOf: (file) => webUtils.getPathForFile(file),
  },
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
