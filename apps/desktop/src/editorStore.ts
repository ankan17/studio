import {applyCommand, History, type Command} from "@studio/editor-core";
import {produce} from "immer";
import type {Project} from "@studio/schema";
import {create} from "zustand";

export type SaveState = "saved" | "dirty" | "saving" | "error";
const AUTOSAVE_MS = 800;

type EditorState = {
  project: Project | null;
  /** media:// URL of the open project's folder. */
  baseUrl: string;
  recovered: boolean;
  saveState: SaveState;
  error: string | null;
  /** Selected clip ids, in the order they were picked. UI state only, never saved. */
  selection: string[];
  /** The last command the editor refused, in words for the status bar. */
  refusal: string | null;
  /** Bumped on every history change so undo and redo buttons re-render. */
  historyRev: number;
  select: (ids: string[]) => void;
  open: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /**
   * Every timeline and clip edit goes through here: the command is applied with inverse patches and recorded for undo.
   * Edits sharing a `coalesce` key within a second are one undo step (a slider drag, a canvas drag). Returns false if
   * the command was refused.
   */
  dispatch: (cmd: Command, opts?: {coalesce?: string; gesture?: boolean; label?: string}) => boolean;
  undo: () => void;
  redo: () => void;
  /**
   * Edits to the asset manifest only (import, metadata, proxies, relink, cleanup). They are not undo steps, so they must
   * not touch the timeline: the recorded patches address tracks by position.
   */
  update: (recipe: (draft: Project) => void) => void;
  flush: () => Promise<void>;
  /** Append an asset to the end of its track. Returns false if it is not ready (no duration yet) or its track is locked. */
  addAssetToTimeline: (assetId: string) => boolean;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();
export const history = new History();

const LABELS: Record<Command["type"], string> = {
  addAsset: "Add clip", moveClips: "Move", trimClip: "Trim", splitClips: "Split", deleteClips: "Delete", duplicateClips: "Duplicate",
  updateClip: "Clip change", addTrack: "Add track", deleteTrack: "Delete track", moveTrack: "Reorder tracks", setTrack: "Track change", setProject: "Project change",
};

/** Selection without clips that no longer exist (after a delete, an undo or a redo). */
function prune(selection: string[], project: Project): string[] {
  if (selection.length === 0) return selection;
  const ids = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = selection.filter((id) => ids.has(id));
  return kept.length === selection.length ? selection : kept;
}

export const useEditor = create<EditorState>((set, get) => {
  const saveNow = (): Promise<void> => {
    inFlight = inFlight.then(async () => {
      const {project, saveState} = get();
      if (!project || saveState === "saved") return;
      set({saveState: "saving"});
      try {
        await window.studio.projects.save(project);
        // edits made while saving keep the state dirty and are saved by their own timer
        set((s) => ({saveState: s.project === project ? "saved" : "dirty", error: null}));
      } catch (err) {
        set({saveState: "error", error: err instanceof Error ? err.message : String(err)});
      }
    });
    return inFlight;
  };
  const changed = (project: Project, extra: Partial<EditorState> = {}) => {
    set((s) => ({project, saveState: "dirty", selection: prune(s.selection, project), historyRev: s.historyRev + 1, ...extra}));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
  };

  return {
    project: null,
    baseUrl: "",
    recovered: false,
    saveState: "saved",
    error: null,
    selection: [],
    refusal: null,
    historyRev: 0,
    select: (ids) => set({selection: ids}),
    open: async (id) => {
      await get().flush();
      const {project, recovered, baseUrl} = await window.studio.projects.open(id);
      history.clear();
      set((s) => ({project, baseUrl, recovered, saveState: "saved", error: null, selection: [], refusal: null, historyRev: s.historyRev + 1}));
    },
    close: async () => {
      await get().flush();
      history.clear();
      set({project: null, recovered: false, saveState: "saved", error: null, selection: [], refusal: null});
    },
    dispatch: (cmd, opts) => {
      const project = get().project;
      if (!project) return false;
      const r = applyCommand(project, cmd);
      if (!r.ok) {
        set({refusal: r.error});
        return false;
      }
      if (r.patches.length === 0) return true;
      history.record({label: opts?.label ?? LABELS[cmd.type], patches: r.patches, inverse: r.inverse, coalesce: opts?.coalesce, gesture: opts?.gesture, at: performance.now()});
      changed(r.project, {refusal: null});
      return true;
    },
    undo: () => {
      const p = get().project;
      const next = p && history.undo(p);
      if (next) changed(next, {refusal: null});
    },
    redo: () => {
      const p = get().project;
      const next = p && history.redo(p);
      if (next) changed(next, {refusal: null});
    },
    update: (recipe) => {
      const project = get().project;
      if (!project) return;
      const next = produce(project, recipe);
      if (next === project) return;
      if ((Object.keys(next) as (keyof Project)[]).some((k) => k !== "assets" && next[k] !== project[k])) {
        throw new Error("update() is for the asset manifest; timeline edits go through dispatch()");
      }
      set({project: next, saveState: "dirty"});
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    },
    addAssetToTimeline: (assetId) => get().dispatch({type: "addAsset", assetId, clipId: crypto.randomUUID(), trackId: crypto.randomUUID()}),
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await saveNow();
      // an edit that landed during the save
      if (get().saveState === "dirty") await saveNow();
    },
  };
});

/** The one clip the inspector shows: the selection when exactly one clip is selected. */
export const useSelectedClipId = () => useEditor((s) => (s.selection.length === 1 ? s.selection[0]! : null));
