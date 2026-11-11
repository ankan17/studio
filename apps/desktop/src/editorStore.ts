import {produce} from "immer";
import {appendAssetClip, type Project} from "@studio/schema";
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
  /** The clip the inspector edits. UI state only, never saved. */
  selectedClipId: string | null;
  selectClip: (id: string | null) => void;
  open: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /** Apply an immer recipe to the project and schedule a debounced autosave. */
  update: (recipe: (draft: Project) => void) => void;
  flush: () => Promise<void>;
  /** Append an asset to the end of its track. Returns false if it is not ready (no duration yet). */
  addAssetToTimeline: (assetId: string) => boolean;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

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

  return {
    project: null,
    baseUrl: "",
    recovered: false,
    saveState: "saved",
    error: null,
    selectedClipId: null,
    selectClip: (id) => set({selectedClipId: id}),
    open: async (id) => {
      await get().flush();
      const {project, recovered, baseUrl} = await window.studio.projects.open(id);
      set({project, baseUrl, recovered, saveState: "saved", error: null, selectedClipId: null});
    },
    close: async () => {
      await get().flush();
      set({project: null, recovered: false, saveState: "saved", error: null, selectedClipId: null});
    },
    update: (recipe) => {
      const project = get().project;
      if (!project) return;
      set({project: produce(project, recipe), saveState: "dirty"});
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    },
    addAssetToTimeline: (assetId) => {
      const asset = get().project?.assets.find((a) => a.id === assetId);
      if (!asset) return false;
      let added = false;
      get().update((p) => void (added = appendAssetClip(p, p.assets.find((a) => a.id === assetId)!, {clip: crypto.randomUUID(), track: crypto.randomUUID()}) !== null));
      return added;
    },
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
