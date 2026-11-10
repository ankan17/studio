import {produce} from "immer";
import type {Project} from "@studio/schema";
import {create} from "zustand";

export type SaveState = "saved" | "dirty" | "saving" | "error";
const AUTOSAVE_MS = 800;

type EditorState = {
  project: Project | null;
  recovered: boolean;
  saveState: SaveState;
  error: string | null;
  open: (id: string) => Promise<void>;
  close: () => Promise<void>;
  /** Apply an immer recipe to the project and schedule a debounced autosave. */
  update: (recipe: (draft: Project) => void) => void;
  flush: () => Promise<void>;
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
    recovered: false,
    saveState: "saved",
    error: null,
    open: async (id) => {
      await get().flush();
      const {project, recovered} = await window.studio.projects.open(id);
      set({project, recovered, saveState: "saved", error: null});
    },
    close: async () => {
      await get().flush();
      set({project: null, recovered: false, saveState: "saved", error: null});
    },
    update: (recipe) => {
      const project = get().project;
      if (!project) return;
      set({project: produce(project, recipe), saveState: "dirty"});
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
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
