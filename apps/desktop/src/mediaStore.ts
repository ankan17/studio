// Renderer-side view of media processing: per-asset progress, which source files are missing, and the glue that turns
// worker events into asset-manifest updates (the renderer owns project.json, so metadata lands via the editor store).
import type {Asset} from "@studio/schema";
import {create} from "zustand";
import {history, useEditor} from "./editorStore";
import type {ImportOutcome, ImportResult, MediaEvent, Stage} from "./ipc";

export type JobState = {status: "queued" | "running" | "error"; stage?: Stage; fraction: number; error?: string};

type MediaState = {
  jobs: Record<string, JobState>;
  missing: Record<string, true>;
  /** Bumped when a thumbnail may have just been written, so <img> elements retry. */
  rev: Record<string, number>;
  notice: string | null;
  setNotice: (n: string | null) => void;
  reset: () => void;
};

export const useMedia = create<MediaState>((set) => ({
  jobs: {},
  missing: {},
  rev: {},
  notice: null,
  setNotice: (notice) => set({notice}),
  reset: () => set({jobs: {}, missing: {}, rev: {}, notice: null}),
}));

const patch = (fn: (s: MediaState) => Partial<MediaState>) => useMedia.setState(fn);
const bump = (s: MediaState, sha: string) => ({rev: {...s.rev, [sha]: (s.rev[sha] ?? 0) + 1}});
const withoutJob = (s: MediaState, sha: string) => {
  const jobs = {...s.jobs};
  delete jobs[sha];
  return jobs;
};

export const proxyPathFor = (sha: string) => `cache/${sha}.proxy.mp4`;

/** Apply one event from main. Events for a project that is no longer open are dropped (reopening re-queues the work). */
export function handleMediaEvent(e: MediaEvent): void {
  const editor = useEditor.getState();
  if (editor.project?.id !== e.projectId) return;
  switch (e.kind) {
    case "meta":
      editor.update((p) => {
        for (const a of p.assets.filter((x) => x.sha256 === e.sha256)) {
          const m = e.meta;
          if (m.durationUs !== undefined) a.durationUs = m.durationUs;
          if (m.fps !== undefined) a.fps = m.fps;
          if (m.width !== undefined) a.width = m.width;
          if (m.height !== undefined) a.height = m.height;
          a.rotation = m.rotation;
          if (m.codec !== undefined) a.codec = m.codec;
          if (m.audioChannels !== undefined) a.audioChannels = m.audioChannels;
          if (m.hdr !== undefined) a.hdr = m.hdr;
        }
      });
      patch((s) => ({jobs: {...s.jobs, [e.sha256]: {...(s.jobs[e.sha256] ?? {fraction: 0}), status: "running"}}}));
      break;
    case "progress":
      patch((s) => ({
        jobs: {...s.jobs, [e.sha256]: {status: "running", stage: e.stage, fraction: e.fraction}},
        ...(e.stage === "thumbs" && e.fraction === 1 ? bump(s, e.sha256) : {}),
      }));
      break;
    case "done":
      editor.update((p) => {
        for (const a of p.assets.filter((x) => x.sha256 === e.sha256 && x.type === "video")) a.proxyPath = proxyPathFor(e.sha256);
      });
      patch((s) => ({jobs: withoutJob(s, e.sha256), ...bump(s, e.sha256)}));
      break;
    case "error":
      patch((s) => ({jobs: {...s.jobs, [e.sha256]: {status: "error", fraction: 0, error: e.message}}}));
      break;
    case "cancelled":
      patch((s) => ({jobs: withoutJob(s, e.sha256)}));
      break;
  }
}

const extOf = (a: Asset) => a.relativePath.split(".").pop()!.toLowerCase();
const needsMeta = (a: Asset) => (a.type !== "image" && a.durationUs === undefined) || (a.type !== "audio" && a.width === undefined);

/** On opening a project (and after imports): queue missing derived files, record which source files are gone. */
export async function ensureMedia(projectId: string, assets: Asset[]): Promise<void> {
  if (assets.length === 0) return;
  const items = assets.map((a) => ({sha256: a.sha256, ext: extOf(a), type: a.type, metaMissing: needsMeta(a)}));
  patch((s) => ({jobs: {...s.jobs, ...Object.fromEntries(items.map((i) => [i.sha256, s.jobs[i.sha256] ?? ({status: "queued", fraction: 0} as JobState)]))}}));
  const {missing, proxies} = await window.studio.media.ensure(projectId, items);
  patch((s) => {
    const jobs = {...s.jobs};
    for (const sha of missing) delete jobs[sha];
    // Only the assets just checked are updated; the others keep their flag.
    const flags = {...s.missing};
    for (const i of items) delete flags[i.sha256];
    for (const sha of missing) flags[sha] = true;
    return {jobs, missing: flags};
  });
  useEditor.getState().update((p) => {
    for (const a of p.assets) if (a.type === "video" && proxies.includes(a.sha256)) a.proxyPath = proxyPathFor(a.sha256);
  });
}

function addAssets(imported: ImportResult[]): number {
  let added = 0;
  useEditor.getState().update((p) => {
    for (const r of imported) {
      if (p.assets.some((a) => a.sha256 === r.sha256)) continue;
      p.assets.push({id: crypto.randomUUID(), relativePath: r.relativePath, type: r.type, sha256: r.sha256, name: r.name, sizeBytes: r.sizeBytes, rotation: 0});
      added++;
    }
  });
  return added;
}

export async function applyImport(projectId: string, outcome: ImportOutcome): Promise<void> {
  const added = addAssets(outcome.imported);
  const dupes = outcome.imported.length - added;
  const parts = [
    added > 0 && `Imported ${added} file${added === 1 ? "" : "s"}.`,
    dupes > 0 && `${dupes} already in this project.`,
    ...outcome.errors.map((x) => `${x.name}: ${x.message}`),
  ].filter(Boolean);
  patch(() => ({notice: parts.join(" ") || null}));
  const project = useEditor.getState().project;
  if (project) await ensureMedia(projectId, project.assets.filter((a) => outcome.imported.some((r) => r.sha256 === a.sha256)));
}

export async function importWithDialog(projectId: string): Promise<void> {
  patch(() => ({notice: null}));
  await applyImport(projectId, await window.studio.media.import(projectId));
}

export async function importDropped(projectId: string, files: File[]): Promise<void> {
  const paths = files.map((f) => window.studio.media.pathOf(f)).filter(Boolean);
  if (paths.length === 0) return;
  await applyImport(projectId, await window.studio.media.importPaths(projectId, paths));
}

export async function relink(projectId: string, asset: Asset): Promise<void> {
  let r;
  try {
    r = await window.studio.media.relink(projectId, asset.sha256, asset.type);
  } catch (err) {
    patch(() => ({notice: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err)}));
    return;
  }
  if (!r) return;
  useEditor.getState().update((p) => {
    const a = p.assets.find((x) => x.id === asset.id);
    if (!a) return;
    Object.assign(a, {relativePath: r.relativePath, sha256: r.sha256, sizeBytes: r.sizeBytes, name: r.name, type: r.type});
    delete a.proxyPath;
    delete a.durationUs;
  });
  patch((s) => {
    const missing = {...s.missing};
    delete missing[asset.sha256];
    return {missing};
  });
  const next = useEditor.getState().project?.assets.find((x) => x.id === asset.id);
  if (next) await ensureMedia(projectId, [next]);
}

export const usedAssetIds = (tracks: {clips: {assetId?: string | undefined}[]}[]): Set<string> =>
  new Set(tracks.flatMap((t) => t.clips.map((c) => c.assetId).filter((x): x is string => !!x)));

/** Remove assets from the manifest, save, then delete their files (never a file another asset still points at). */
export async function removeAssets(projectId: string, assets: Asset[]): Promise<void> {
  const ids = new Set(assets.map((a) => a.id));
  const editor = useEditor.getState();
  editor.update((p) => void (p.assets = p.assets.filter((a) => !ids.has(a.id))));
  // Undo could otherwise bring back a clip whose file is about to be deleted.
  history.clear();
  useEditor.setState((s) => ({historyRev: s.historyRev + 1}));
  await editor.flush();
  if (useEditor.getState().saveState !== "saved") {
    patch(() => ({notice: "Could not save the project, so no files were deleted."}));
    return;
  }
  const remaining = new Set(useEditor.getState().project?.assets.map((a) => a.sha256));
  const doomed = [...new Map(assets.filter((a) => !remaining.has(a.sha256)).map((a) => [a.sha256, a])).values()];
  await window.studio.media.deleteAssets(projectId, doomed.map((a) => ({sha256: a.sha256, ext: extOf(a)})));
}

export function formatDuration(us: number | undefined): string {
  if (us === undefined) return "";
  const s = Math.round(us / 1e6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
