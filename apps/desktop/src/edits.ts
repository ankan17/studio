// Editing actions shared by the timeline toolbar, its context menus and the keyboard, so each does the same thing
// wherever it is triggered. They turn the selection and the playhead into commands for the editor store.
import {locate, transitionRoom} from "@studio/editor-core";
import type {TransitionKind} from "@studio/schema";
import {clipsAtFrame} from "@studio/schema";
import {create} from "zustand";
import {useEditor} from "./editorStore";
import {usePlayback} from "./playback";

const ed = () => useEditor.getState();
const TITLE_SECONDS = 3;
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
  /** Put the selected video clip's sound on an audio track and mute the video. */
  detachAudio(): boolean {
    const {selection, dispatch, select} = ed();
    if (selection.length !== 1) return false;
    const id = crypto.randomUUID();
    if (!dispatch({type: "detachAudio", clipId: selection[0]!, newClipId: id, trackId: crypto.randomUUID()})) return false;
    select([id]); // the new sound clip, ready to move or adjust
    return true;
  },
  /** A three-second title at the playhead, selected so the inspector shows its text. */
  addText(): boolean {
    const {project, dispatch, select} = ed();
    if (!project) return false;
    const id = crypto.randomUUID();
    const frame = usePlayback.getState().frame;
    if (!dispatch({type: "addText", clipId: id, trackId: crypto.randomUUID(), startFrame: frame, durationInFrames: Math.round(TITLE_SECONDS * project.fps), content: "Title"})) return false;
    select([id]);
    return true;
  },
  /** A transition from the selected clip into the next one (half a second, or as long as the cut allows), or none. */
  setTransition(kind: TransitionKind | null, clipId = ed().selection[0]): boolean {
    const {project, dispatch} = ed();
    if (!project || !clipId) return false;
    // eslint-disable-next-line @remotion/non-pure-animation -- a command field named "transition", not CSS
    if (kind === null) return dispatch({type: "setTransition", clipId, transition: null});
    const room = transitionRoom(project, clipId);
    if (room.reason) {
      useEditor.setState({refusal: room.reason});
      return false;
    }
    const current = locate(project, clipId)?.clip.transitionOut?.durationInFrames;
    const d = Math.min(room.max, current ?? Math.round(project.fps / 2));
    // eslint-disable-next-line @remotion/non-pure-animation -- a command field named "transition", not CSS
    return dispatch({type: "setTransition", clipId, transition: {kind, durationInFrames: d}});
  },
  selectAll(): void {
    const {project, select} = ed();
    if (project) select(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  },
  /** A marker at the playhead, unnamed; double-click it on the ruler to name it. */
  addMarker(): boolean {
    const {project, dispatch} = ed();
    if (!project) return false;
    const frame = usePlayback.getState().frame;
    if (project.markers.some((m) => m.frame === frame)) {
      useEditor.setState({refusal: "There is already a marker here"});
      return false;
    }
    return dispatch({type: "addMarker", markerId: crypto.randomUUID(), frame, label: ""});
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
