// Renderer-side view of the running export. Main owns the export; this only mirrors its events and starts or cancels it.
import type {ExportHeight, ExportRecord} from "@studio/schema";
import {create} from "zustand";
import {useEditor} from "./editorStore";
import type {ExportEvent} from "./ipc";

type ExportState = {
  open: boolean;
  height: ExportHeight;
  running: {exportId: string; fileName: string; fraction: number; elapsedMs: number; etaMs: number | null} | null;
  /** The last export that ended in this session, shown until the dialog closes. */
  last: ExportRecord | null;
  history: ExportRecord[];
  /** Why an export could not start (empty timeline, missing media, a folder that cannot be written). */
  startError: string | null;
  setOpen: (open: boolean) => void;
  setHeight: (h: ExportHeight) => void;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  loadHistory: () => Promise<void>;
  reset: () => void;
};

export const useExport = create<ExportState>((set, get) => ({
  open: false,
  height: 1080,
  running: null,
  last: null,
  history: [],
  startError: null,
  setOpen: (open) => {
    set(open ? {open, startError: null} : {open, last: get().running ? get().last : null, startError: null});
    if (open) void get().loadHistory();
  },
  setHeight: (height) => set({height}),
  start: async () => {
    const project = useEditor.getState().project;
    if (!project || get().running) return;
    set({startError: null, last: null});
    try {
      await useEditor.getState().flush(); // main reads the project from disk, so the latest edits must be there
      const started = await window.studio.exports.start(project.id, get().height);
      if (started) set({running: {exportId: started.exportId, fileName: started.fileName, fraction: 0, elapsedMs: 0, etaMs: null}});
    } catch (e) {
      set({startError: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e)});
    }
  },
  cancel: async () => {
    const r = get().running;
    if (r) await window.studio.exports.cancel(r.exportId);
  },
  loadHistory: async () => {
    const id = useEditor.getState().project?.id;
    if (!id) return;
    const history = await window.studio.exports.list(id).catch(() => []);
    if (useEditor.getState().project?.id === id) set({history});
  },
  reset: () => set({open: false, running: null, last: null, history: [], startError: null}),
}));

export function handleExportEvent(e: ExportEvent): void {
  const projectId = useEditor.getState().project?.id;
  if (e.projectId !== projectId) return;
  if (e.kind === "progress") {
    const r = useExport.getState().running;
    if (r && r.exportId === e.exportId) useExport.setState({running: {...r, fraction: e.fraction, elapsedMs: e.elapsedMs, etaMs: e.etaMs}});
    return;
  }
  useExport.setState((s) => ({running: null, last: e.record, history: [...s.history.filter((h) => h.id !== e.record.id), e.record]}));
}
