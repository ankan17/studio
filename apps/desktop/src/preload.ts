import {contextBridge, ipcRenderer} from "electron";
import {IPC, type MemoryMetrics, type StudioApi} from "./ipc";

const api: StudioApi = {
  openMedia: () => ipcRenderer.invoke(IPC.openMedia),
  onMetrics: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, m: MemoryMetrics) => listener(m);
    ipcRenderer.on(IPC.metrics, handler);
    return () => ipcRenderer.removeListener(IPC.metrics, handler);
  },
};

contextBridge.exposeInMainWorld("studio", api);
