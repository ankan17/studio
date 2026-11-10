import {ProjectStore} from "@studio/project-store";
import {app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent} from "electron";
import fs from "node:fs";
import path from "node:path";
import {IPC, Req, type MediaHandle, type ProjectCard} from "./ipc";
import type {z} from "zod";
import {allowMediaRoot, handleMediaProtocol, mediaUrl, registerMediaScheme} from "./media-protocol";
import {startMemorySampler} from "./memory-sampler";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;
let store: ProjectStore;
let flushResolve: (() => void) | null = null;
let closing = false;

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

  // Ask the renderer to save pending edits before the window closes (it has 3s to answer).
  mainWindow.on("close", (e) => {
    if (closing || !mainWindow) return;
    e.preventDefault();
    closing = true;
    const win = mainWindow;
    const done = new Promise<void>((resolve) => {
      flushResolve = resolve;
      win.webContents.send(IPC.flushRequest);
      setTimeout(resolve, 3000);
    });
    void done.then(() => win.close());
  });

  const stop = startMemorySampler((m) => mainWindow?.webContents.send(IPC.metrics, m));
  mainWindow.on("closed", () => {
    stop();
    mainWindow = null;
  });
}

// Validated handler: trusted sender, then Zod-parse the single argument. Invalid input is rejected before any work.
function handle<S extends z.ZodType, R>(channel: string, schema: S | null, fn: (input: z.infer<S>) => Promise<R> | R): void {
  ipcMain.handle(channel, (event, raw: unknown) => {
    assertTrusted(event);
    return fn(schema ? schema.parse(raw) : (undefined as z.infer<S>));
  });
}

ipcMain.handle(IPC.flushDone, (event) => {
  assertTrusted(event);
  flushResolve?.();
});

async function toCard(s: Awaited<ReturnType<ProjectStore["list"]>>[number]): Promise<ProjectCard> {
  return {...s, thumbnailUrl: s.hasThumbnail ? `${mediaUrl(store.thumbnailPath(s.id))}?v=${encodeURIComponent(s.updatedAt)}` : null};
}

handle(IPC.projects.list, null, async () => Promise.all((await store.list()).map(toCard)));
handle(IPC.projects.create, Req.create, (req) => store.create(req));
handle(IPC.projects.open, Req.id, ({id}) => store.open(id));
handle(IPC.projects.save, Req.save, ({project}) => store.save(project));
handle(IPC.projects.rename, Req.rename, ({id, name}) => store.rename(id, name));
handle(IPC.projects.duplicate, Req.duplicate, ({id, fps}) => store.duplicate(id, {fps}));
handle(IPC.projects.setThumbnail, Req.setThumbnail, ({id, jpeg}) => store.setThumbnail(id, jpeg));
handle(IPC.projects.remove, Req.id, async ({id}) => {
  const {project} = await store.open(id);
  const answer = await dialog.showMessageBox(mainWindow!, {
    type: "warning",
    buttons: ["Move to Trash", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Move "${project.name}" to the Trash?`,
    detail: "The project folder, including its copied media, goes to the Trash.",
  });
  if (answer.response !== 0) return false;
  await store.delete(id);
  return true;
});

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

void app.whenReady().then(async () => {
  // No page needs camera, microphone, notifications or similar.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  // Projects live in the app data folder (override with STUDIO_PROJECTS_DIR for development).
  const root = process.env.STUDIO_PROJECTS_DIR ?? path.join(app.getPath("userData"), "projects");
  store = new ProjectStore(root, {remove: (dir) => shell.trashItem(dir)});
  await store.init();
  allowMediaRoot(root); // thumbnails are served from project folders
  handleMediaProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
