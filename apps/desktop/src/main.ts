import {app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent} from "electron";
import fs from "node:fs";
import path from "node:path";
import {IPC, type MediaHandle} from "./ipc";
import {allowMediaRoot, handleMediaProtocol, mediaUrl, registerMediaScheme} from "./media-protocol";
import {startMemorySampler} from "./memory-sampler";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;

// Every handler must call this: the call has to come from the top frame of the editor window.
function assertTrusted(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Blocked IPC call from an untrusted sender.");
  }
}

function isAppUrl(url: string): boolean {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  return url.startsWith("file://");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Playback timing must not stall when the window is behind others.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({action: "deny"}));
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));

  const stop = startMemorySampler((m) => mainWindow?.webContents.send(IPC.metrics, m));
  mainWindow.on("closed", () => {
    stop();
    mainWindow = null;
  });
}

ipcMain.handle(IPC.openMedia, async (event): Promise<MediaHandle | null> => {
  assertTrusted(event);
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [{name: "Media", extensions: ["mp4", "mov", "m4v", "mp3", "m4a", "wav", "jpg", "jpeg", "png"]}],
  });
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  allowMediaRoot(path.dirname(file));
  return {name: path.basename(file), url: mediaUrl(file), sizeMB: Math.round(fs.statSync(file).size / 1048576)};
});

void app.whenReady().then(() => {
  // No page needs camera, microphone, notifications or similar.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handleMediaProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
