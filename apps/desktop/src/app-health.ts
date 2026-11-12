// Reliability and release plumbing in main (M7): a local log, local crash dumps, the session lock, the application
// menu (shortcut sheet, manual update check, "Report a problem"). Nothing here sends anything anywhere except the update
// check, which the user starts from the menu: one GET to the project's GitHub releases page, carrying no user data.
import {isNewerVersion} from "@studio/schema";
import {app, BrowserWindow, clipboard, crashReporter, dialog, Menu, net, shell, type MenuItemConstructorOptions} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {z} from "zod";
import {IPC} from "./ipc";

const LOG_MAX_BYTES = 2 * 1024 * 1024;
export const RELEASES_API = "https://api.github.com/repos/ankan17/studio/releases/latest";
const RELEASE_PAGE_PREFIX = "https://github.com/ankan17/studio/";

let logDir = "";
const logFile = () => path.join(logDir, "studio.log");

export function initLog(): void {
  // Development and end-to-end runs may point the log somewhere else; a packaged build always uses ~/Library/Logs/Studio.
  logDir = (!app.isPackaged && process.env.STUDIO_LOG_DIR) || app.getPath("logs");
  fs.mkdirSync(logDir, {recursive: true});
}

export function log(level: "info" | "warn" | "error", message: string): void {
  if (!logDir) return;
  try {
    const file = logFile();
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${message.replace(/\n/g, "\n  ")}\n`);
  } catch {
    /* a log that cannot be written must never take the app down */
  }
}

/** Crashes of the app itself: minidumps stay on this Mac, and uncaught errors go to the log. */
export function initCrashHandling(): void {
  crashReporter.start({uploadToServer: false, compress: true, productName: "Studio"});
  process.on("uncaughtException", (err) => log("error", `uncaughtException ${err.stack ?? err.message}`));
  process.on("unhandledRejection", (reason) => log("error", `unhandledRejection ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
  app.on("child-process-gone", (_e, d) => log("error", `child process gone: ${d.type} ${d.reason} (exit ${d.exitCode}) ${d.name ?? ""}`));
  app.on("render-process-gone", (_e, wc, d) => log("error", `renderer gone: ${wc.getURL().replace(/\?.*/, "")} ${d.reason} (exit ${d.exitCode})`));
}

export const RendererError = z.object({message: z.string().max(2000), stack: z.string().max(8000).optional()});
export const SessionState = {previousCrash: false};

/** What the user can paste into a bug report. Paths and project names are not included. */
export function diagnostics(): string {
  let tail = "";
  try {
    tail = fs.readFileSync(logFile(), "utf8").split("\n").slice(-40).join("\n");
  } catch {
    /* no log yet */
  }
  let dumps = 0;
  try {
    dumps = fs.readdirSync(app.getPath("crashDumps"), {recursive: true}).filter((n) => String(n).endsWith(".dmp")).length;
  } catch {
    /* none */
  }
  return [
    `Studio ${app.getVersion()} (${app.isPackaged ? "packaged" : "development"})`,
    `macOS ${os.release()} ${process.arch}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM, ${Math.round(os.freemem() / 2 ** 20)} MB free`,
    `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}`,
    `Last session ended ${SessionState.previousCrash ? "unexpectedly" : "normally"}; ${dumps} crash dump(s) on disk`,
    "",
    "Last log lines:",
    tail.trim() || "(log is empty)",
  ].join("\n");
}

async function reportProblem(win: BrowserWindow | null): Promise<void> {
  const text = diagnostics();
  const options = {
    type: "info" as const,
    message: "Report a problem",
    detail: `${text}\n\nNothing is sent anywhere. Copy these details into a message, and attach the log folder if asked.`,
    buttons: ["Copy details", "Show logs in Finder", "Close"],
    defaultId: 0,
    cancelId: 2,
  };
  const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (r.response === 0) clipboard.writeText(text);
  else if (r.response === 1) showLogs();
}

function showLogs(): void {
  const file = logFile();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else void shell.openPath(logDir);
}

const Release = z.object({tag_name: z.string().max(64), html_url: z.string().url().max(500)});

export async function checkForUpdates(win: BrowserWindow | null): Promise<void> {
  const show = (message: string, detail?: string, buttons = ["OK"]) => {
    const o = {type: "info" as const, message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1};
    return win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o);
  };
  try {
    const res = await net.fetch(RELEASES_API, {headers: {Accept: "application/vnd.github+json", "User-Agent": "Studio-update-check"}, signal: AbortSignal.timeout(10_000)});
    if (res.status === 404) return void (await show("No update found", `There are no published releases yet. You have Studio ${app.getVersion()}.`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = Release.parse(await res.json());
    if (!isNewerVersion(app.getVersion(), rel.tag_name)) return void (await show("Studio is up to date", `You have Studio ${app.getVersion()}, the newest version.`));
    const r = await show(`Studio ${rel.tag_name.replace(/^v/, "")} is available`, `You have ${app.getVersion()}. Download the new disk image, open it and drag Studio over the old one. Your projects are not touched.`, ["Open download page", "Not now"]);
    if (r.response === 0 && rel.html_url.startsWith(RELEASE_PAGE_PREFIX)) void shell.openExternal(rel.html_url);
  } catch (err) {
    log("warn", `update check failed: ${err instanceof Error ? err.message : String(err)}`);
    await show("Could not check for updates", "Check your internet connection and try again.");
  }
}

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const dev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    {role: "appMenu"},
    {role: "editMenu"},
    {label: "View", submenu: [...(dev ? ([{role: "reload"}, {role: "toggleDevTools"}, {type: "separator"}] as MenuItemConstructorOptions[]) : []), {role: "togglefullscreen"}]},
    {role: "windowMenu"},
    {
      role: "help",
      submenu: [
        {label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+/", click: () => getWindow()?.webContents.send(IPC.showShortcuts)},
        {type: "separator"},
        {label: "Check for Updates…", click: () => void checkForUpdates(getWindow())},
        {label: "Report a Problem…", click: () => void reportProblem(getWindow())},
        {label: "Show Logs in Finder", click: showLogs},
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
