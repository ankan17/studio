import {cacheFile, fileExists, findMissing, importAssetFile, ImportError, ProjectStore, removeAssetFiles, sweepOrphanAssets, sweepStaleImports, type ImportedFile} from "@studio/project-store";
import {app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent} from "electron";
import fs from "node:fs";
import path from "node:path";
import {ExportReq, IPC, MediaReq, Req, type ImportOutcome, type MediaHandle, type ProjectCard} from "./ipc";
import type {z} from "zod";
import {allowMediaRoot, handleMediaProtocol, mediaUrl, registerMediaScheme} from "./media-protocol";
import {ExportService} from "./export-service";
import {MediaService} from "./media-service";
import {startMemorySampler} from "./memory-sampler";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

registerMediaScheme();
// Development only: Vite serves the workspace packages' source as `immutable` under a hash that changes only with
// dependencies, so Chromium's on-disk cache would keep running an old editor-core or schema after an edit.
if (!app.isPackaged) app.commandLine.appendSwitch("disable-http-cache");

const E2E_ARGS = process.env.STUDIO_E2E === "1" && !app.isPackaged ? ["--studio-e2e"] : [];
let mainWindow: BrowserWindow | null = null;
let store: ProjectStore;
let media: MediaService;
let exporter: ExportService;
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
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0e0f11",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {x: 18, y: 15},
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Playback timing must not stall when the window is behind others.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: E2E_ARGS,
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
    // The hidden worker is a window too: leaving it open would stop "window-all-closed" and the dock re-open check.
    media?.shutdown();
    exporter?.shutdown();
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
handle(IPC.projects.open, Req.id, async ({id}) => {
  const opened = await store.open(id);
  // Copies that never made it into a saved manifest (window closed inside the autosave debounce). Not after a recovery.
  if (!opened.recovered) await sweepOrphanAssets(store.dir(id), opened.project.assets.map((a) => a.sha256)).catch(() => undefined);
  return {...opened, baseUrl: mediaUrl(store.dir(id))};
});
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
  await media.cancelAndWait(id); // no late write may recreate the folder
  await store.delete(id);
  return true;
});


// ---- media import and processing (M2)
// Development and end-to-end runs only: STUDIO_E2E_PICK_FILE names a JSON file holding the paths a dialog would return,
// so the real import and relink code runs without driving a native dialog. Ignored in packaged builds.
const E2E = E2E_ARGS.length > 0;
async function pickFiles(options: Electron.OpenDialogOptions): Promise<string[]> {
  const stub = process.env.STUDIO_E2E_PICK_FILE;
  if (E2E && stub) return JSON.parse(await fs.promises.readFile(stub, "utf8")) as string[];
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result.canceled ? [] : result.filePaths;
}

// Same idea for the export save dialog: STUDIO_E2E_SAVE_FILE names a text file holding the path the dialog would
// return (empty means the dialog was cancelled). The suggested file name is written next to it, for the test to read.
async function pickSavePath(suggestedName: string): Promise<string | null> {
  const stub = process.env.STUDIO_E2E_SAVE_FILE;
  if (E2E && stub) {
    await fs.promises.writeFile(`${stub}.suggested`, suggestedName);
    return (await fs.promises.readFile(stub, "utf8")).trim() || null;
  }
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Export video",
    defaultPath: path.join(app.getPath("videos"), suggestedName),
    filters: [{name: "MP4 video", extensions: ["mp4"]}],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

const MEDIA_FILTER = [{name: "Media", extensions: ["mp4", "mov", "m4v", "mp3", "m4a", "wav", "jpg", "jpeg", "png"]}];

async function projectDir(projectId: string): Promise<string> {
  const dir = store.dir(projectId); // throws for anything that is not a UUID
  await fs.promises.access(path.join(dir, "project.json"));
  return dir;
}

async function importPaths(projectId: string, paths: string[]): Promise<ImportOutcome> {
  const dir = await projectDir(projectId);
  const out: ImportOutcome = {imported: [], errors: []};
  const seen = new Set<string>();
  for (const file of paths) {
    try {
      const r: ImportedFile = await importAssetFile(dir, file, {denyUnder: store.root});
      if (!seen.has(r.sha256)) out.imported.push(r);
      seen.add(r.sha256);
    } catch (err) {
      // Only expected failures reach the user with their message; anything else is logged and summarised.
      if (!(err instanceof ImportError)) console.error("[import]", err);
      out.errors.push({name: path.basename(file), message: err instanceof ImportError ? err.message : "Could not copy this file."});
    }
  }
  return out;
}

const queueFor = (projectId: string, r: {sha256: string; ext: string; type: "video" | "audio" | "image"}, metaMissing: boolean) =>
  media.enqueue({projectId, sha256: r.sha256, ext: r.ext, type: r.type, metaMissing});

handle(IPC.media.import, MediaReq.import, async ({projectId}) => {
  await projectDir(projectId);
  const picked = await pickFiles({properties: ["openFile", "multiSelections"], filters: MEDIA_FILTER});
  if (picked.length === 0) return {imported: [], errors: []} satisfies ImportOutcome;
  const out = await importPaths(projectId, picked);
  for (const r of out.imported) queueFor(projectId, r, true);
  return out;
});
handle(IPC.media.importPaths, MediaReq.importPaths, async ({projectId, paths}) => {
  const out = await importPaths(projectId, paths);
  for (const r of out.imported) queueFor(projectId, r, true);
  return out;
});
handle(IPC.media.relink, MediaReq.relink, async ({projectId, type}) => {
  const dir = await projectDir(projectId);
  const file = (await pickFiles({properties: ["openFile"], filters: MEDIA_FILTER, message: "Choose the replacement file"}))[0];
  if (!file) return null;
  const r = await importAssetFile(dir, file, {denyUnder: store.root});
  // Clips keep their source offsets, so a replacement must at least be the same kind of media.
  if (r.type !== type) throw new ImportError(`That file is ${r.type}, but the missing one is ${type}.`);
  queueFor(projectId, r, true);
  return r;
});
handle(IPC.media.ensure, MediaReq.ensure, async ({projectId, items}) => {
  const dir = await projectDir(projectId);
  await sweepStaleImports(dir); // copies abandoned by a crash or a window closed mid-import
  const missing = new Set(await findMissing(dir, items));
  const proxies: string[] = [];
  for (const i of items) {
    if (missing.has(i.sha256)) continue;
    if (i.type === "video" && (await fileExists(cacheFile(dir, i.sha256, "proxy.mp4")))) proxies.push(i.sha256);
    queueFor(projectId, i, i.metaMissing);
  }
  return {missing: [...missing], proxies};
});
handle(IPC.media.cancel, MediaReq.cancel, ({projectId, sha256}) => media.cancel(projectId, sha256));
handle(IPC.media.readPeaks, MediaReq.peaks, async ({projectId, sha256}) => {
  const file = cacheFile(await projectDir(projectId), sha256, "peaks");
  const data = await fs.promises.readFile(file).catch(() => null);
  return data && data.byteLength > 0 ? new Uint8Array(data) : null;
});
handle(IPC.media.deleteAssets, MediaReq.remove, async ({projectId, items}) => {
  const dir = await projectDir(projectId);
  for (const i of items) {
    await media.cancelAndWait(projectId, i.sha256); // a running job must stop writing before its files go
    await removeAssetFiles(dir, i.sha256, i.ext);
  }
});

// ---- export (M6)
handle(IPC.exports.start, ExportReq.start, ({projectId, height}) => exporter.start(projectId, height));
handle(IPC.exports.cancel, ExportReq.cancel, ({exportId}) => exporter.cancel(exportId));
handle(IPC.exports.list, ExportReq.list, ({projectId}) => exporter.list(projectId));

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
  allowMediaRoot(root); // thumbnails, proxies and imported assets are served from project folders
  media = new MediaService({
    projectDir: (id) => store.dir(id),
    emit: (e) => mainWindow?.webContents.send(IPC.media.event, e),
    // The first imported clip or image becomes the project's dashboard thumbnail, unless one is set already.
    onThumb: (projectId, file) => {
      void (async () => {
        if (await fileExists(store.thumbnailPath(projectId))) return;
        await store.setThumbnail(projectId, new Uint8Array(await fs.promises.readFile(file)));
      })().catch(() => undefined);
    },
  });
  exporter = new ExportService({store, emit: (e) => mainWindow?.webContents.send(IPC.exports.event, e), pickSavePath});
  handleMediaProtocol();
  createWindow();
});

app.on("before-quit", () => {
  media?.shutdown();
  exporter?.shutdown();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
