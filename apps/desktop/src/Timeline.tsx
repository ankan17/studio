// The route timeline. Each track is a coloured line (its media type), clips ride on it, cuts are station ticks, and a
// cut that lines up across tracks is an interchange ring.
//
// Editing: drag a clip to move it (across tracks of the same kind too), drag its edges to trim, with snapping to clip
// edges, the playhead and markers. Shift or Cmd click adds to the selection. Right-click opens a menu. Markers on the
// ruler: click to jump, drag to move, double-click to name, right-click to rename or delete. Every edit is
// one command through the editor store, so it can be undone.
//
// Performance: only rows and clips inside the viewport are rendered (React never sees the rest), clip bodies with their
// filmstrips and waveforms are painted onto one canvas per visible row, and scrolling and zoom are this component's own
// state, so the canvas and the DOM move in the same frame.
import {applyCommand, clampTrim, clipKind, fits, locate, transitionRoom, resolveMove, snap, snapPoints, type Command} from "@studio/editor-core";
import {projectDurationFrames, timecode, type Asset, type Clip, type Project, type Track} from "@studio/schema";
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {edits, MAX_PPF, useView, view} from "./edits";
import {history, useEditor} from "./editorStore";
import {Eye, EyeOff, FitWidth, Flag, TextT, Lock, Magnet, Minus, Mute, Plus, Redo, Scissors, Trash, Undo, Unlock, Volume} from "./icons";
import {ContextMenu, type MenuState} from "./Menu";
import {useMedia} from "./mediaStore";
import {playback, usePlayback} from "./playback";
import {evictImages, image, peaksFor} from "./timelineMedia";
import {LINE, Roundel, clock, type LineKind} from "./ui";

const LABEL_W = 168;
const PAD = 14;
const ROW_H = 60;
const HEAD_H = 36;
const RULER_H = 26;
const SCROLL_H = 10;
const MAX_ROWS = 4;
const INSET = 7; // clip block inset from the row's top and bottom
const SNAP_PX = 8;
const DRAG_PX = 3;
const TILES = 60; // filmstrip sprite: 60 tiles of 160x90 across the whole source (media-worker.ts)
const TILE_W = 160;
const TILE_H = 90;
const PEAK_S = 0.01;

const isMac = navigator.platform.startsWith("Mac");
const MOD = isMac ? "⌘" : "Ctrl+";

/** A track's line: the type of its first clip's asset, or its own type when empty. */
function trackKind(t: Track, kindOf: (c: Clip, t: Track) => LineKind): LineKind {
  return t.clips[0] ? kindOf(t.clips[0], t) : t.type === "audio" ? "audio" : t.type === "text" ? "text" : t.type === "image" ? "image" : "video";
}

/** Clips of a track overlapping frames [from, to); clips are sorted by start and never overlap, so a binary search finds the first. */
function visibleClips(t: Track, from: number, to: number): Clip[] {
  const cs = t.clips;
  let lo = 0;
  let hi = cs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid]!.startFrame + cs[mid]!.durationInFrames <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: Clip[] = [];
  for (let i = lo; i < cs.length && cs[i]!.startFrame < to; i++) out.push(cs[i]!);
  return out;
}

/** Ruler step in frames: the smallest that leaves at least 84px between labels. */
function rulerStep(fps: number, ppf: number): number {
  const steps = [1, 2, 5, 10, 15].filter((f) => f < fps).concat([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map((s) => s * fps));
  return steps.find((s) => s * ppf >= 84) ?? 3600 * fps;
}

type Colors = Record<LineKind | "surface" | "ink", string>;
function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(`--color-${n}`).trim();
  return {video: v("video"), audio: v("audio"), image: v("still"), text: v("still"), surface: v("surface"), ink: v("ink")};
}
/** `a` mixed into `b` by `t` (hex colours), like color-mix(in srgb, a t, b). */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((c, i) => Math.round(c * t + y[i]! * (1 - t))).join(" ")})`;
}

type Gesture =
  | {kind: "scrub"; resume: boolean}
  | {kind: "move"; id: string; ids: string[]; x0: number; y0: number; started: boolean; collapseTo: string | null}
  | {kind: "trim"; id: string; edge: "start" | "end"; x0: number; started: boolean}
  | {kind: "marker"; id: string; x0: number; started: boolean}
  | {kind: "scrollbar"; x0: number; scroll0: number};

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const dispatch = useEditor((s) => s.dispatch);
  const baseUrl = useEditor((s) => s.baseUrl);
  useEditor((s) => s.historyRev); // undo and redo buttons follow the history
  const frame = usePlayback((s) => s.frame);
  const playing = usePlayback((s) => s.playing);
  const {ppf: zoomPpf, fitPpf, scrollX, scrollY, snapping} = useView();
  const rev = useMedia((s) => s.rev);

  const panel = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const gesture = useRef<Gesture | null>(null);
  const [width, setWidth] = useState(1200);
  const [preview, setPreview] = useState<{cmd: Command; snapAt: number | null} | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const lastMarkerClick = useRef<{id: string; at: number} | null>(null); // pointer capture retargets dblclick, so count clicks here
  const [drawTick, setDrawTick] = useState(0);
  const redraw = useCallback(() => setDrawTick((n) => n + 1), []);
  const colors = useMemo(readColors, []);

  // While dragging, the timeline shows the result of the command the drag would commit, so what you see is what you get.
  const shown: Project = useMemo(() => {
    if (!preview) return project;
    const r = applyCommand(project, preview.cmd);
    return r.ok ? r.project : project;
  }, [project, preview]);

  const fps = project.fps;
  const total = projectDurationFrames(project);
  const laneW = Math.max(100, width - LABEL_W);
  const fit = (laneW - PAD * 2) / Math.max(total * 1.06, fps * 12);
  const ppf = zoomPpf ?? fit;
  const contentW = PAD * 2 + Math.max(total * ppf + laneW * 0.5, laneW - PAD * 2);
  const maxScroll = zoomPpf === null ? 0 : Math.max(0, contentW - laneW);
  const sx = Math.min(scrollX, maxScroll);
  const rows = Math.min(MAX_ROWS, Math.max(1, project.tracks.length));
  const bodyH = rows * ROW_H;
  const maxScrollY = Math.max(0, project.tracks.length * ROW_H - bodyH);
  const sy = Math.min(scrollY, maxScrollY);
  const x = (f: number) => PAD + f * ppf - sx; // frame to lane x
  const fromF = Math.floor((sx - PAD) / ppf) - 1;
  const toF = Math.ceil((sx + laneW) / ppf) + 1;

  useEffect(() => useView.setState({fitPpf: fit}), [fit]);
  // keep the stored scroll in range when the edit gets shorter or the zoom changes
  useEffect(() => {
    if (scrollX !== sx || scrollY !== sy) useView.setState({scrollX: sx, scrollY: sy});
  }, [scrollX, sx, scrollY, sy]);

  // Follow the playhead while playing: page forward when it leaves the lane.
  useEffect(() => {
    if (!playing || zoomPpf === null) return;
    const px = x(frame);
    if (px > laneW - 24 || px < 0) useView.setState({scrollX: Math.max(0, PAD + frame * ppf - laneW * 0.1)});
  });

  const assets = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);
  // a clip on an audio track is sound, even when it comes from a video (detached audio)
  const kindOf = useCallback((c: Clip, t: Track): LineKind => (t.type === "audio" ? "audio" : t.type === "text" ? "text" : (c.assetId && assets.get(c.assetId)?.type) || "video"), [assets]);
  const firstRow = Math.floor(sy / ROW_H);
  const lastRow = Math.min(project.tracks.length - 1, Math.floor((sy + bodyH - 1) / ROW_H));
  const rowTracks = useMemo(() => shown.tracks.map((t, i) => ({t, i})).filter(({i}) => i >= firstRow && i <= lastRow), [shown.tracks, firstRow, lastRow]);
  const clipCount = project.tracks.reduce((n, t) => n + t.clips.length, 0);
  const selected = useMemo(() => new Set(selection), [selection]);

  // ---- canvas: clip bodies, filmstrips, waveforms
  useLayoutEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const used = new Set<string>();
    for (const {t} of rowTracks) {
      const c = canvases.current.get(t.id);
      if (!c) continue;
      if (c.width !== Math.round(laneW * dpr)) c.width = Math.round(laneW * dpr);
      if (c.height !== ROW_H * dpr) c.height = ROW_H * dpr;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, laneW, ROW_H);
      for (const clip of visibleClips(t, fromF, toF)) {
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
        drawClip(ctx, {clip, asset, x0: PAD + clip.startFrame * ppf - sx, w: clip.durationInFrames * ppf, laneW, fps, ppf, colors, kind: kindOf(clip, t), baseUrl, projectId: project.id, rev: asset ? (rev[asset.sha256] ?? 0) : 0, used, redraw});
      }
    }
    evictImages(used);
  }, [rowTracks, fromF, toF, ppf, sx, laneW, rev, drawTick, redraw, assets, kindOf, baseUrl, colors, fps, project.id]);

  // ---- measuring and wheel
  useLayoutEffect(() => {
    const el = panel.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    const onWheel = (e: WheelEvent) => {
      if (!lane.current) return;
      e.preventDefault();
      const r = lane.current.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        view.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, PAD); // pinch or Cmd+wheel zooms around the pointer
        return;
      }
      const {scrollX: x0, scrollY: y0} = useView.getState();
      const vertical = Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey;
      // a vertical wheel scrolls the tracks when they overflow, otherwise it scrolls through time
      if (vertical && el.dataset.overflowY === "true") useView.setState({scrollY: Math.max(0, y0 + e.deltaY)});
      else useView.setState({scrollX: Math.max(0, x0 + (vertical ? e.deltaY : e.deltaX))});
    };
    el.addEventListener("wheel", onWheel, {passive: false});
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ---- pointer gestures on the lanes
  const laneX = (clientX: number) => clientX - lane.current!.getBoundingClientRect().left;
  const toFrame = (clientX: number) => (laneX(clientX) - PAD + sx) / ppf;
  const rowAt = (clientY: number) => Math.floor((clientY - lane.current!.getBoundingClientRect().top - RULER_H + sy) / ROW_H);

  const moveCmd = (g: Extract<Gesture, {kind: "move"}>, e: React.PointerEvent): {cmd: Command; snapAt: number | null} | null => {
    let delta = Math.round((e.clientX - g.x0) / ppf);
    const found = g.ids.map((id) => locate(project, id));
    if (found.some((m) => !m)) return null; // the clip went away mid-drag
    const located = found as NonNullable<(typeof found)[number]>[];
    // one track's clips can change track together; a selection spread over tracks keeps its tracks
    let toTrackId: string | undefined;
    const sameTrack = new Set(located.map((m) => m.track.id)).size === 1;
    const target = project.tracks[rowAt(e.clientY)];
    if (sameTrack && target && target.id !== located[0]!.track.id && !target.locked && located.every((m) => fits(clipKind(project, m.clip, m.track), target))) toTrackId = target.id;
    let snapAt: number | null = null;
    if (snapping) {
      const edges = located.flatMap((m) => [m.clip.startFrame + delta, m.clip.startFrame + m.clip.durationInFrames + delta]);
      const s = snap(edges, snapPoints(project, {exclude: new Set(g.ids), playhead: frame}), SNAP_PX / ppf);
      delta += s.adjust;
      snapAt = s.at;
    }
    const legal = resolveMove(project, g.ids, delta, toTrackId) ?? (toTrackId ? resolveMove(project, g.ids, delta) : null);
    if (legal === null) return null;
    const usedTrack = toTrackId && resolveMove(project, g.ids, delta, toTrackId) !== null ? toTrackId : undefined;
    return {cmd: {type: "moveClips", clipIds: g.ids, deltaFrames: legal, toTrackId: usedTrack}, snapAt: legal === delta ? snapAt : null};
  };

  const trimCmd = (g: Extract<Gesture, {kind: "trim"}>, e: React.PointerEvent): {cmd: Command; snapAt: number | null} | null => {
    const found = locate(project, g.id);
    if (!found) return null;
    const {clip} = found;
    let delta = Math.round((e.clientX - g.x0) / ppf);
    const edge = g.edge === "start" ? clip.startFrame : clip.startFrame + clip.durationInFrames;
    let snapAt: number | null = null;
    if (snapping) {
      const s = snap([edge + delta], snapPoints(project, {exclude: new Set([g.id]), playhead: frame}), SNAP_PX / ppf);
      delta += s.adjust;
      snapAt = s.at;
    }
    const d = clampTrim(project, g.id, g.edge, delta);
    return {cmd: {type: "trimClip", clipId: g.id, edge: g.edge, deltaFrames: d}, snapAt: d === delta ? snapAt : null};
  };

  const markerCmd = (g: Extract<Gesture, {kind: "marker"}>, e: React.PointerEvent): {cmd: Command; snapAt: number | null} | null => {
    const m = project.markers.find((x) => x.id === g.id);
    if (!m) return null;
    let f = Math.max(0, m.frame + Math.round((e.clientX - g.x0) / ppf));
    let snapAt: number | null = null;
    if (snapping) {
      const s = snap([f], snapPoints({tracks: project.tracks, markers: project.markers.filter((x) => x.id !== g.id)}, {playhead: frame}), SNAP_PX / ppf);
      f = Math.max(0, f + s.adjust);
      snapAt = s.at;
    }
    return {cmd: {type: "updateMarker", markerId: g.id, patch: {frame: f}}, snapAt};
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, [data-no-gesture]")) return;
    const el = e.currentTarget;
    const additive = e.shiftKey || e.metaKey || (e.ctrlKey && !isMac); // on a Mac, Ctrl-click is the context menu
    const bar = target.closest<HTMLElement>("[data-scrollbar]");
    if (bar) {
      gesture.current = {kind: "scrollbar", x0: e.clientX, scroll0: sx};
      el.setPointerCapture(e.pointerId);
      return;
    }
    const tr = target.closest<HTMLElement>("[data-transition]");
    if (tr) {
      select([tr.dataset.transition!]); // the transition belongs to the clip before the cut
      return;
    }
    const marker = target.closest<HTMLElement>("[data-marker]");
    if (marker) {
      gesture.current = {kind: "marker", id: marker.dataset.marker!, x0: e.clientX, started: false};
      document.body.dataset.dragging = "true";
      el.setPointerCapture(e.pointerId);
      return;
    }
    const hit = target.closest<HTMLElement>("[data-clip]");
    if (hit) {
      const id = hit.dataset.clip!;
      const loc = locate(project, id);
      const trim = target.closest<HTMLElement>("[data-trim]")?.dataset.trim as "start" | "end" | undefined;
      let next = selection;
      if (additive) next = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
      else if (!selected.has(id) || trim) next = [id]; // a trim handle trims its own clip, even inside a selection
      select(next);
      if (!next.includes(id) || !loc || loc.track.locked) return;
      if (next.some((c) => locate(project, c)?.track.locked)) {
        // the same rule as the menu: a selection that includes a locked clip does not move
        useEditor.setState({refusal: "Part of the selection is on a locked track"});
        return;
      }
      gesture.current = trim
        ? {kind: "trim", id, edge: trim, x0: e.clientX, started: false}
        : {kind: "move", id, ids: next, x0: e.clientX, y0: e.clientY, started: false, collapseTo: additive || !selected.has(id) || selection.length === 1 ? null : id};
      document.body.dataset.dragging = "true";
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (target.closest("[data-lane]") || target.closest("[data-ruler]")) {
      if (!additive && !target.closest("[data-ruler]")) select([]);
      gesture.current = {kind: "scrub", resume: usePlayback.getState().playing};
      el.setPointerCapture(e.pointerId);
      playback.pause();
      playback.seek(toFrame(e.clientX));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (g.kind === "scrub") playback.seek(toFrame(e.clientX));
    else if (g.kind === "scrollbar") useView.setState({scrollX: Math.max(0, g.scroll0 + ((e.clientX - g.x0) * contentW) / laneW)});
    else {
      if (!g.started && Math.abs(e.clientX - g.x0) < DRAG_PX && (g.kind !== "move" || Math.abs(e.clientY - g.y0) < DRAG_PX)) return;
      g.started = true;
      setPreview(g.kind === "move" ? moveCmd(g, e) : g.kind === "trim" ? trimCmd(g, e) : markerCmd(g, e));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    delete document.body.dataset.dragging;
    if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.kind === "scrub" && g.resume) playback.play();
    if (g.kind === "marker") {
      const final = g.started ? markerCmd(g, e) : null;
      if (final) dispatch(final.cmd, {label: "Move marker"});
      else {
        const m = project.markers.find((x) => x.id === g.id);
        if (m) playback.seek(m.frame); // a click jumps to the marker, a second click names it
        const last = lastMarkerClick.current;
        if (last?.id === g.id && e.timeStamp - last.at < 400) {
          setRenaming(g.id);
          lastMarkerClick.current = null;
        } else lastMarkerClick.current = {id: g.id, at: e.timeStamp};
      }
      setPreview(null);
    }
    if (g.kind === "move" || g.kind === "trim") {
      // commit from the final pointer position, not the last rendered preview (which can be a move behind)
      const final = g.started ? (g.kind === "move" ? moveCmd(g, e) : trimCmd(g, e)) : null;
      if (final) dispatch(final.cmd);
      else if (g.kind === "move" && !g.started && g.collapseTo) select([g.collapseTo]); // a plain click inside a selection picks that clip
      setPreview(null);
    }
  };

  // ---- context menus
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const at = {x: e.clientX, y: e.clientY};
    const hit = target.closest<HTMLElement>("[data-clip]");
    const head = target.closest<HTMLElement>("[data-track-head]");
    const marker = target.closest<HTMLElement>("[data-marker]");
    if (marker) {
      const id = marker.dataset.marker!;
      setMenu({...at, label: "Marker", items: [
        {label: "Rename", onSelect: () => setRenaming(id)},
        {label: "Delete marker", onSelect: () => dispatch({type: "deleteMarker", markerId: id}), danger: true},
      ]});
    } else if (hit) {
      const id = hit.dataset.clip!;
      if (!selected.has(id)) select([id]);
      const ids = selected.has(id) ? selection : [id];
      const editable = ids.every((c) => !locate(project, c)?.track.locked);
      const inside = ids.some((c) => {
        const cl = locate(project, c)?.clip;
        return !!cl && frame > cl.startFrame && frame < cl.startFrame + cl.durationInFrames;
      });
      setMenu({...at, label: "Clip", items: [
        {label: "Split at playhead", shortcut: "S", onSelect: edits.split, disabled: !inside || !editable},
        {label: "Duplicate", shortcut: `${MOD}D`, onSelect: edits.duplicate, disabled: !editable},
        ...(ids.length === 1 && canDetach(project, ids[0]!) ? [{label: "Detach audio", onSelect: edits.detachAudio, disabled: !editable}] : []),
        ...(ids.length === 1 && locate(project, ids[0]!)?.clip.transitionOut
          ? [{label: "Remove transition", onSelect: () => edits.setTransition(null, ids[0]), disabled: !editable}]
          : ids.length === 1 && !transitionRoom(project, ids[0]!).reason
            ? [{label: "Add dissolve to next", onSelect: () => edits.setTransition("fade", ids[0]), disabled: !editable}]
            : []),
        {label: ids.length > 1 ? `Delete ${ids.length} clips` : "Delete", shortcut: "⌫", onSelect: edits.delete, disabled: !editable, danger: true},
        "separator",
        {label: "Select all", shortcut: `${MOD}A`, onSelect: edits.selectAll},
      ]});
    } else if (head) {
      const t = project.tracks.find((x) => x.id === head.dataset.trackHead)!;
      const i = project.tracks.indexOf(t);
      const set = (patch: {locked?: boolean; visible?: boolean; muted?: boolean}) => dispatch({type: "setTrack", trackId: t.id, patch});
      setMenu({...at, label: "Track", items: [
        {label: t.visible ? "Hide track" : "Show track", onSelect: () => set({visible: !t.visible})},
        ...(t.type === "text" ? [] : [{label: t.muted ? "Unmute track" : "Mute track", onSelect: () => set({muted: !t.muted})}]),
        {label: t.locked ? "Unlock track" : "Lock track", onSelect: () => set({locked: !t.locked})},
        "separator",
        {label: "Move up", onSelect: () => dispatch({type: "moveTrack", trackId: t.id, toIndex: i - 1}), disabled: i === 0},
        {label: "Move down", onSelect: () => dispatch({type: "moveTrack", trackId: t.id, toIndex: i + 1}), disabled: i === project.tracks.length - 1},
        "separator",
        {label: "Add video track", onSelect: () => edits.addTrack("video")},
        {label: "Add audio track", onSelect: () => edits.addTrack("audio")},
        "separator",
        {label: t.clips.length ? `Delete track and its ${t.clips.length} ${t.clips.length === 1 ? "clip" : "clips"}` : "Delete track", onSelect: () => dispatch({type: "deleteTrack", trackId: t.id}), disabled: t.locked, danger: true},
      ]});
    } else {
      setMenu({...at, label: "Timeline", items: [
        {label: "Add video track", onSelect: () => edits.addTrack("video")},
        {label: "Add audio track", onSelect: () => edits.addTrack("audio")},
        "separator",
        {label: "Select all", shortcut: `${MOD}A`, onSelect: edits.selectAll, disabled: clipCount === 0},
      ]});
    }
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  // ---- cuts and interchanges (visible range only)
  const {cuts, interchanges} = useMemo(() => {
    const per = new Map<string, Set<number>>();
    const count = new Map<number, number>();
    for (const {t} of rowTracks) {
      const set = new Set<number>();
      const cs = visibleClips(t, fromF, toF);
      const starts = new Set(t.clips.map((c) => c.startFrame));
      for (const c of cs) {
        if (c.startFrame > 0) set.add(c.startFrame);
        const end = c.startFrame + c.durationInFrames;
        if (starts.has(end)) set.add(end);
      }
      per.set(t.id, set);
      for (const f of set) count.set(f, (count.get(f) ?? 0) + 1);
    }
    return {cuts: per, interchanges: [...count].filter(([, n]) => n >= 2).map(([f]) => f)};
  }, [rowTracks, fromF, toF]);

  // ---- ruler
  const step = rulerStep(fps, ppf);
  const minor = step % 5 === 0 && (step / 5) * ppf >= 10 ? step / 5 : step % 2 === 0 && (step / 2) * ppf >= 10 ? step / 2 : 0;
  const ticks: number[] = [];
  for (let f = Math.max(0, Math.floor(fromF / step) * step); f <= toF; f += step) ticks.push(f);
  const minors: number[] = [];
  if (minor) for (let f = Math.max(0, Math.floor(fromF / minor) * minor); f <= toF; f += minor) if (f % step) minors.push(f);
  const label = (f: number) => (step < fps ? timecode(f, fps) : clock(f / fps));
  const head = x(frame);
  const visibleCount = rowTracks.reduce((n, {t}) => n + visibleClips(t, fromF, toF).length, 0);

  const zoomV = Math.log(ppf / fitPpf) / Math.log(MAX_PPF / fitPpf || 2);
  // track tags: A for audio, T for titles, V for pictures, numbered within each
  const letter = (t: Track) => (t.type === "audio" ? "A" : t.type === "text" ? "T" : "V");
  const trackTag = (t: Track, i: number) => `${letter(t)}${project.tracks.filter((x, j) => j <= i && letter(x) === letter(t)).length}`;

  return (
    <div
      ref={panel}
      className="panel relative select-none overflow-hidden"
      style={{height: HEAD_H + RULER_H + bodyH + SCROLL_H + 2}}
      data-testid="sequence"
      data-ppf={ppf}
      data-scroll-x={sx}
      data-lane-left={LABEL_W}
      data-pad={PAD}
      data-rendered-clips={visibleCount}
      data-overflow-y={maxScrollY > 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={openMenu}
    >
      {/* header: tools */}
      <div className="flex items-center gap-1 border-b border-line-soft pl-3.5 pr-2" style={{height: HEAD_H}} data-no-gesture>
        <h2 className="text-heading font-semibold">Timeline</h2>
        {clipCount > 0 && <span className="tnum ml-1.5 text-caption text-ink-3">{clipCount} {clipCount === 1 ? "clip" : "clips"} · {clock(total / fps)}</span>}
        <div className="flex-1" />
        <button className="icon-btn" title={`Undo${history.undoLabel ? ` ${history.undoLabel.toLowerCase()}` : ""} (${MOD}Z)`} aria-label="Undo" disabled={!history.canUndo} onClick={() => useEditor.getState().undo()}><Undo /></button>
        <button className="icon-btn" title={`Redo${history.redoLabel ? ` ${history.redoLabel.toLowerCase()}` : ""} (⇧${MOD}Z)`} aria-label="Redo" disabled={!history.canRedo} onClick={() => useEditor.getState().redo()}><Redo /></button>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <button className="icon-btn" title="Split at the playhead (S)" aria-label="Split" disabled={clipCount === 0} onClick={edits.split}><Scissors /></button>
        <button className="icon-btn" title="Delete selected clips (⌫)" aria-label="Delete clips" disabled={!edits.selectionEditable()} onClick={edits.delete}><Trash /></button>
        <button className="icon-btn" title="Snapping (N)" aria-label="Snapping" aria-pressed={snapping} onClick={view.toggleSnapping}><Magnet /></button>
        <button className="icon-btn" title="Add a marker at the playhead (M)" aria-label="Add marker" onClick={edits.addMarker}><Flag /></button>
        <button className="icon-btn" title="Add a title at the playhead (T)" aria-label="Add title" onClick={edits.addText}><TextT /></button>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <button
          className="btn btn-ghost !h-[30px] !px-2"
          title="Add a track"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({x: r.left, y: r.bottom + 4, label: "Add track", items: [
              {label: "Add video track", onSelect: () => edits.addTrack("video")},
              {label: "Add audio track", onSelect: () => edits.addTrack("audio")},
            ]});
          }}
        >
          <Plus size={14} /> Track
        </button>
        <span className="mx-1.5 h-4 w-px bg-line" />
        <button className="icon-btn" title={`Zoom out (${MOD}−)`} aria-label="Zoom out" disabled={zoomPpf === null} onClick={() => view.zoomBy(1 / 1.5)}><Minus /></button>
        <input
          type="range"
          aria-label="Zoom"
          className="w-[88px]"
          min={0}
          max={1}
          step={0.001}
          value={Math.max(0, Math.min(1, zoomV))}
          style={{"--pct": `${Math.max(0, Math.min(1, zoomV)) * 100}%`} as React.CSSProperties}
          onChange={(e) => view.zoomBy((fitPpf * Math.pow(MAX_PPF / fitPpf, Number(e.target.value))) / ppf)}
        />
        <button className="icon-btn" title={`Zoom in (${MOD}=)`} aria-label="Zoom in" disabled={ppf >= MAX_PPF} onClick={() => view.zoomBy(1.5)}><Plus /></button>
        <button className="icon-btn" title="Fit the whole edit (⇧Z)" aria-label="Zoom to fit" aria-pressed={zoomPpf === null} onClick={view.fit}><FitWidth /></button>
      </div>

      {/* ruler */}
      <div className="absolute overflow-hidden border-b border-line-soft" style={{left: LABEL_W, right: 0, top: HEAD_H, height: RULER_H}} data-ruler>
        {minors.map((f) => (
          <span key={`m${f}`} className="pointer-events-none absolute bottom-0 h-[5px] w-px bg-line" style={{left: x(f)}} />
        ))}
        {ticks.filter((f) => x(f) + 36 <= laneW - 4 && !(x(f) > head - 40 && x(f) < head + 92)).map((f) => (
          <span key={f} className="num pointer-events-none absolute top-[5px] border-l border-line pl-1.5 text-[10.5px] leading-[14px] text-ink-3" style={{left: x(f)}}>
            {label(f)}
          </span>
        ))}
        {shown.markers.map((m) => (
          <div key={m.id} className="group absolute inset-y-0 z-[2] flex cursor-pointer items-end" style={{left: x(m.frame) - 7}} data-marker={m.id} data-testid="marker" title={m.label || "Marker: double-click to name"}>
            <span className="mb-[-4px] h-[8px] w-[8px] translate-x-[3px] rotate-45 bg-ink-2 group-hover:bg-ink" />
            {m.label && renaming !== m.id && <span className="mb-[3px] ml-[5px] max-w-[140px] truncate rounded-[3px] bg-raised px-1 text-[10.5px] leading-[14px] text-ink-2">{m.label}</span>}
          </div>
        ))}
        {renaming && shown.markers.some((m) => m.id === renaming) && (
          <MarkerName
            key={renaming}
            left={x(shown.markers.find((m) => m.id === renaming)!.frame) + 8}
            value={shown.markers.find((m) => m.id === renaming)!.label}
            onDone={(label) => {
              if (label !== null) dispatch({type: "updateMarker", markerId: renaming, patch: {label}}, {label: "Rename marker"});
              setRenaming(null);
            }}
          />
        )}
      </div>

      {/* rows */}
      <div className="absolute inset-x-0 overflow-hidden" style={{top: HEAD_H + RULER_H, height: bodyH}}>
        {project.tracks.length === 0 && (
          <div className="grid place-items-center text-body text-ink-2" style={{height: ROW_H}} data-lane>Your timeline is empty. Clips you add appear here, in order.</div>
        )}
        {rowTracks.map(({t, i}) => {
          const kind = trackKind(t, kindOf);
          const tag = trackTag(t, i);
          const set = (patch: {locked?: boolean; visible?: boolean; muted?: boolean}) => dispatch({type: "setTrack", trackId: t.id, patch});
          const dim = !t.visible || (t.type === "audio" && t.muted);
          return (
            <div key={t.id} className="absolute inset-x-0 flex border-b border-line-soft" style={{top: i * ROW_H - sy, height: ROW_H}} data-testid="track" data-track={t.id}>
              <div className="flex shrink-0 items-center gap-2 border-r border-line-soft pl-3.5 pr-1.5" style={{width: LABEL_W}} data-track-head={t.id} data-no-gesture>
                <Roundel kind={kind} />
                <span className="tag text-ink-2">{tag}</span>
                <span className="flex-1" />
                {t.type !== "audio" && (
                  <button className="icon-btn !h-6 !w-6" aria-pressed={!t.visible} title={t.visible ? `Hide ${tag}` : `Show ${tag}`} aria-label={t.visible ? `Hide track ${tag}` : `Show track ${tag}`} onClick={() => set({visible: !t.visible})}>
                    {t.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                )}
                {t.type !== "text" && <button className="icon-btn !h-6 !w-6" aria-pressed={t.muted} title={t.muted ? `Unmute ${tag}` : `Mute ${tag}`} aria-label={t.muted ? `Unmute track ${tag}` : `Mute track ${tag}`} onClick={() => set({muted: !t.muted})}>
                  {t.muted ? <Mute size={14} /> : <Volume size={14} />}
                </button>}
                <button className="icon-btn !h-6 !w-6" aria-pressed={t.locked} title={t.locked ? `Unlock ${tag}` : `Lock ${tag}`} aria-label={t.locked ? `Unlock track ${tag}` : `Lock track ${tag}`} onClick={() => set({locked: !t.locked})}>
                  {t.locked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </div>
              <div className="relative flex-1 overflow-hidden" data-lane>
                <div className="pointer-events-none absolute top-1/2 -mt-[2px] h-1 rounded-full opacity-70" style={{background: LINE[kind].color, left: Math.max(0, x(0) - PAD), right: 0}} />
                <canvas ref={(c) => void (c ? canvases.current.set(t.id, c) : canvases.current.delete(t.id))} className="pointer-events-none absolute left-0 top-0" style={{width: laneW, height: ROW_H, opacity: dim ? 0.4 : 1}} />
                {visibleClips(t, fromF, toF).map((c) => {
                  const left = x(c.startFrame);
                  const w = Math.max(2, c.durationInFrames * ppf - 2);
                  const asset = c.assetId ? assets.get(c.assetId) : undefined;
                  const sel = selected.has(c.id);
                  const handle = Math.min(8, w / 3);
                  return (
                    <div
                      key={c.id}
                      className={`group absolute rounded-[5px] border border-[rgb(234_237_242/0.1)] ${sel ? "outline-2 outline-offset-1 outline-go" : ""} ${t.locked ? "" : "hover:border-[rgb(234_237_242/0.3)]"}`}
                      style={{left, width: w, top: INSET, bottom: INSET, opacity: dim ? 0.55 : 1}}
                      data-testid="clip-block"
                      data-clip={c.id}
                      data-selected={sel || undefined}
                      title={asset?.name}
                    >
                      <div className="pointer-events-none truncate px-2 pt-1 text-[11px] font-medium leading-[14px] text-ink [text-shadow:0_1px_2px_var(--color-ground)]">
                        {c.text ? c.text.content || "Empty title" : (asset?.name ?? "Missing file")}
                        {c.speed !== 1 && <span className="num text-ink-2"> · {Number(c.speed.toFixed(2))}×</span>}
                      </div>
                      {!t.locked && w > 12 && (
                        <>
                          <div data-trim="start" className="absolute inset-y-0 left-0 cursor-ew-resize" style={{width: handle}}>
                            <span className={`absolute inset-y-2 left-[2px] w-[3px] rounded-full bg-ink ${sel ? "opacity-90" : "opacity-0 group-hover:opacity-70"}`} />
                          </div>
                          <div data-trim="end" className="absolute inset-y-0 right-0 cursor-ew-resize" style={{width: handle}}>
                            <span className={`absolute inset-y-2 right-[2px] w-[3px] rounded-full bg-ink ${sel ? "opacity-90" : "opacity-0 group-hover:opacity-70"}`} />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                {visibleClips(t, fromF, toF).map((c, i, vis) => {
                  const tr = c.transitionOut;
                  const next = vis[i + 1] ?? t.clips[t.clips.indexOf(c) + 1];
                  if (!tr || !next || next.startFrame !== c.startFrame + c.durationInFrames) return null;
                  const cut = next.startFrame;
                  const left = x(cut - Math.floor(tr.durationInFrames / 2));
                  return (
                    <span
                      key={`tr-${c.id}`}
                      className="absolute top-1/2 z-[4] h-[16px] -translate-y-1/2 cursor-pointer rounded-full border-2 border-ink bg-surface/80 [background-image:linear-gradient(115deg,transparent_45%,var(--color-ink)_45%,var(--color-ink)_55%,transparent_55%)]"
                      style={{left, width: Math.max(12, tr.durationInFrames * ppf)}}
                      data-transition={c.id}
                      data-testid="transition"
                      title={`${tr.kind === "fade" ? "Dissolve" : tr.kind === "slide" ? "Slide" : "Wipe"}, ${(tr.durationInFrames / fps).toFixed(2)} s`}
                    />
                  );
                })}
                {[...(cuts.get(t.id) ?? [])].filter((f) => !interchanges.includes(f)).map((f) => (
                  <span key={f} className="pointer-events-none absolute bottom-[2px] top-[2px] z-[2] w-[4px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{left: x(f)}} />
                ))}
                {t.locked && <span className="pointer-events-none absolute inset-0 z-[3] bg-ground/50" title="Locked" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* overlays across the lanes: interchanges, snap guide, playhead */}
      <div ref={lane} className="pointer-events-none absolute bottom-0 overflow-hidden" style={{left: LABEL_W, right: 0, top: HEAD_H}}>
        {interchanges.map((f) => (
          <span key={f} className="absolute z-[3] w-[14px] -translate-x-1/2 rounded-[7px] border-[3px] border-ink bg-surface/50 ring-2 ring-surface" style={{left: x(f), top: RULER_H + 2, height: Math.min(bodyH, (lastRow + 1) * ROW_H - sy) - 4}} title="Cuts line up across tracks" />
        ))}
        {preview?.snapAt != null && <div className="absolute z-[4] w-px bg-ink" style={{left: x(preview.snapAt), top: RULER_H, height: bodyH}} data-testid="snap-guide" />}
        <div className="absolute z-10 w-0" style={{left: head, top: 0, height: RULER_H + bodyH}} data-testid="playhead">
          <div className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-go" />
          <div className="absolute h-[14px] w-[14px] -translate-x-1/2 rounded-full bg-go ring-[3px] ring-surface" style={{top: RULER_H - 7}} />
          <div className="num absolute left-[10px] top-[4px] whitespace-nowrap rounded-[4px] bg-go px-1.5 text-[10.5px] font-medium leading-4 text-go-ink">{timecode(frame, fps)}</div>
        </div>
      </div>

      {/* scrollbars */}
      {maxScroll > 0 && (
        <div className="absolute" style={{left: LABEL_W, right: 0, bottom: 0, height: SCROLL_H}} data-scrollbar>
          <div className="absolute top-[3px] h-[4px] rounded-full bg-line hover:bg-ink-3" style={{left: (sx / contentW) * laneW, width: Math.max(24, (laneW / contentW) * laneW)}} />
        </div>
      )}
      {maxScrollY > 0 && (
        <div className="pointer-events-none absolute right-[2px] w-[4px] rounded-full bg-line" style={{top: HEAD_H + RULER_H + (sy / (project.tracks.length * ROW_H)) * bodyH, height: (bodyH / (project.tracks.length * ROW_H)) * bodyH}} />
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}

/** The inline name field for a marker: Enter or leaving the field saves, Escape cancels. */
function MarkerName({left, value, onDone}: {left: number; value: string; onDone: (label: string | null) => void}) {
  const done = useRef(false);
  const finish = (label: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(label);
  };
  return (
    <input
      autoFocus
      data-no-gesture
      aria-label="Marker name"
      className="field absolute top-[3px] z-[5] !h-5 w-[160px] !px-1.5 !text-[11px]"
      style={{left}}
      defaultValue={value}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

/** A video clip on a picture track whose media has sound. */
function canDetach(p: Project, clipId: string): boolean {
  const m = locate(p, clipId);
  const asset = m && p.assets.find((a) => a.id === m.clip.assetId);
  return !!m && !!asset && m.track.type !== "audio" && asset.type === "video" && asset.audioChannels !== 0;
}

type DrawArgs = {
  clip: Clip; asset: Asset | undefined; x0: number; w: number; laneW: number; fps: number; ppf: number; colors: Colors; kind: LineKind;
  baseUrl: string; projectId: string; rev: number; used: Set<string>; redraw: () => void;
};

/** One clip body: tinted block, then its filmstrip (video), repeated still (image) or waveform (audio), then its line bar. */
function drawClip(ctx: CanvasRenderingContext2D, a: DrawArgs): void {
  const {clip, asset, x0, laneW, ppf, fps, colors, kind} = a;
  const w = Math.max(2, a.w - 2);
  const top = INSET;
  const h = ROW_H - INSET * 2;
  const from = Math.max(x0, -8);
  const to = Math.min(x0 + w, laneW + 8);
  if (to <= from) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, top, w, h, 5);
  ctx.clip();
  ctx.fillStyle = mix(colors[kind], colors.surface, 0.2);
  ctx.fillRect(from, top, to - from, h);
  const speed = clip.speed;
  const srcAt = (px: number) => clip.sourceStartUs / 1e6 + (px / ppf / fps) * speed; // seconds into the source at clip x
  if (asset && kind === "video" && asset.durationUs) {
    const url = `${a.baseUrl}/cache/${asset.sha256}.filmstrip.jpg?v=${a.rev}`;
    a.used.add(url);
    const img = image(url, a.redraw);
    if (img) {
      const slotW = (h * TILE_W) / TILE_H;
      const dur = asset.durationUs / 1e6;
      ctx.globalAlpha = 0.5;
      for (let i = Math.max(0, Math.floor((from - x0) / slotW)); x0 + i * slotW < to; i++) {
        const tile = Math.min(TILES - 1, Math.max(0, Math.floor((srcAt(i * slotW) / dur) * TILES)));
        ctx.drawImage(img, tile * TILE_W, 0, TILE_W, TILE_H, x0 + i * slotW, top, slotW, h);
      }
      ctx.globalAlpha = 1;
    }
  } else if (asset && kind === "image") {
    const url = `${a.baseUrl}/cache/${asset.sha256}.thumb.jpg?v=${a.rev}`;
    a.used.add(url);
    const img = image(url, a.redraw);
    if (img && img.naturalHeight) {
      const slotW = (h * img.naturalWidth) / img.naturalHeight;
      ctx.globalAlpha = 0.5;
      for (let i = Math.max(0, Math.floor((from - x0) / slotW)); x0 + i * slotW < to; i++) ctx.drawImage(img, x0 + i * slotW, top, slotW, h);
      ctx.globalAlpha = 1;
    }
  } else if (asset && kind === "audio") {
    const peaks = peaksFor(a.projectId, `${asset.sha256}:${a.rev}`, asset.sha256, a.redraw);
    if (peaks) {
      const waveTop = top + 17;
      const waveH = h - 17 - 5;
      const mid = waveTop + waveH / 2;
      ctx.fillStyle = colors.audio;
      ctx.globalAlpha = 0.75;
      for (let px = Math.floor(from - x0); px < to - x0; px += 2) {
        const i0 = Math.max(0, Math.floor(srcAt(px) / PEAK_S));
        const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(srcAt(px + 2) / PEAK_S)));
        let m = 0;
        for (let i = i0; i < i1; i++) m = Math.max(m, peaks[i]!);
        const bh = Math.max(1, (m / 255) * waveH);
        ctx.fillRect(x0 + px, mid - bh / 2, 1.25, bh);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = colors[kind];
  ctx.fillRect(from, top + h - 3, to - from, 3);
  ctx.restore();
}
