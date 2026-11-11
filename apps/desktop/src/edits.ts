// Editing actions shared by the timeline toolbar, its context menus and the keyboard, so each does the same thing
// wherever it is triggered. They turn the selection and the playhead into commands for the editor store.
import {locate} from "@studio/editor-core";
import {clipsAtFrame} from "@studio/schema";
import {create} from "zustand";
import {useEditor} from "./editorStore";
import {usePlayback} from "./playback";

const ed = () => useEditor.getState();
const newIds = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, crypto.randomUUID()]));

export const edits = {
  /** Split the selected clips under the playhead; with nothing selected, every clip under it on an unlocked track. */
  split(): boolean {
    const {project, selection, dispatch} = ed();
    if (!project) return false;
    const frame = usePlayback.getState().frame;
    const under = clipsAtFrame(project, frame).filter(({track, clip}) => !track.locked && frame > clip.startFrame);
    const ids = (selection.length ? under.filter(({clip}) => selection.includes(clip.id)) : under).map(({clip}) => clip.id);
    if (ids.length === 0) {
      const lockedHit = clipsAtFrame(project, frame).some(({track, clip}) => track.locked && (!selection.length || selection.includes(clip.id)));
      useEditor.setState({refusal: lockedHit ? "That track is locked" : selection.length ? "The playhead is not inside the selected clip" : "The playhead is not inside a clip"});
      return false;
    }
    return dispatch({type: "splitClips", frame, clipIds: ids, newIds: newIds(ids)});
  },
  delete(): boolean {
    const {selection, dispatch} = ed();
    if (selection.length === 0) return false;
    return dispatch({type: "deleteClips", clipIds: selection});
  },
  duplicate(): boolean {
    const {selection, dispatch, select} = ed();
    if (selection.length === 0) return false;
    const ids = newIds(selection);
    if (!dispatch({type: "duplicateClips", clipIds: selection, newIds: ids})) return false;
    select(Object.values(ids)); // the copies are selected, ready to move
    return true;
  },
  selectAll(): void {
    const {project, select} = ed();
    if (project) select(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  },
  addTrack(kind: "video" | "audio"): void {
    ed().dispatch({type: "addTrack", trackId: crypto.randomUUID(), kind});
  },
  /** Whether every selected clip is on an unlocked track (the toolbar disables delete and duplicate otherwise). */
  selectionEditable(): boolean {
    const {project, selection} = ed();
    return !!project && selection.length > 0 && selection.every((id) => !locate(project, id)?.track.locked);
  },
};

// ---- timeline view: zoom, scroll and snapping. UI state, never saved.

/** Pixels per frame at the deepest zoom: a frame is 40px wide. */
export const MAX_PPF = 40;

type View = {
  /** Pixels per frame, or null to fit the whole edit in the lane. */
  ppf: number | null;
  /** The fit value for the current lane width and edit length, kept up to date by the timeline. */
  fitPpf: number;
  scrollX: number;
  scrollY: number;
  snapping: boolean;
};
export const useView = create<View>(() => ({ppf: null, fitPpf: 1, scrollX: 0, scrollY: 0, snapping: true}));

export const view = {
  ppf: () => useView.getState().ppf ?? useView.getState().fitPpf,
  /** Zoom by a factor, keeping the frame under `anchorX` (lane pixels from the left of the lane) where it is. */
  zoomBy(factor: number, anchorX?: number, pad = 14): void {
    const {fitPpf, scrollX} = useView.getState();
    const old = view.ppf();
    const next = Math.min(MAX_PPF, Math.max(fitPpf, old * factor));
    if (next === old) return;
    // keep the playhead in place when no pointer position is given
    const ax = anchorX ?? pad + usePlayback.getState().frame * old - scrollX;
    const frameAt = (ax - pad + scrollX) / old;
    useView.setState({ppf: next <= fitPpf * 1.0001 ? null : next, scrollX: Math.max(0, frameAt * next - ax + pad)});
  },
  fit: () => useView.setState({ppf: null, scrollX: 0}),
  toggleSnapping: () => useView.setState((s) => ({snapping: !s.snapping})),
  reset: () => useView.setState({ppf: null, scrollX: 0, scrollY: 0}),
};
