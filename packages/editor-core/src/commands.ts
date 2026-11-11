// Timeline commands. Every edit to the timeline is one typed command applied to the project with immer, which hands back
// the forward patches and their inverse. Undo applies the inverse; nothing keeps whole-project snapshots.
// A command is plain data, so the same shape could later be called as a tool by an agent (project plan, Summary).
//
// Rules the commands keep:
// - clips on one track never overlap; a command that would make them overlap fails and changes nothing
// - a clip on a locked track cannot be changed, and nothing can be moved onto a locked track
// - a video or image clip lives on a video track, an audio clip on an audio track
// - positions are integer frames, source offsets integer microseconds: sourceDurationUs = durationInFrames / fps * speed * 1e6
// Commands never generate ids: the caller passes them, so a command replays to the same result.
import {appendAssetClip, isTextPreset, TextSchema, type Clip, type Project, type Track} from "@studio/schema";
import {current, enablePatches, produceWithPatches, type Patch} from "immer";

enablePatches();

export type ClipPatch = {
  transform?: Partial<Clip["transform"]>;
  fit?: Clip["fit"];
  /** Fractions of the displayed source; null removes the crop. */
  crop?: Clip["crop"] | null;
  volume?: number;
  muted?: boolean;
  fadeInFrames?: number;
  fadeOutFrames?: number;
};

type Text = NonNullable<Clip["text"]>;
/** A change to a title's style; null removes the background, outline or shadow. */
export type TextPatch = Partial<Omit<Text, "background" | "stroke" | "shadow">> & {background?: string | null; stroke?: Text["stroke"] | null; shadow?: Text["shadow"] | null};

export type Command =
  | {type: "addAsset"; assetId: string; clipId: string; trackId: string}
  | {type: "moveClips"; clipIds: string[]; deltaFrames: number; toTrackId?: string}
  | {type: "trimClip"; clipId: string; edge: "start" | "end"; deltaFrames: number}
  | {type: "splitClips"; frame: number; clipIds: string[]; newIds: Record<string, string>}
  | {type: "deleteClips"; clipIds: string[]}
  | {type: "duplicateClips"; clipIds: string[]; newIds: Record<string, string>}
  | {type: "updateClip"; clipId: string; patch: ClipPatch}
  | {type: "addTrack"; trackId: string; kind: "video" | "audio"; index?: number}
  | {type: "deleteTrack"; trackId: string}
  | {type: "moveTrack"; trackId: string; toIndex: number}
  | {type: "setTrack"; trackId: string; patch: {locked?: boolean; visible?: boolean; muted?: boolean}}
  | {type: "setProject"; patch: {name?: string; backgroundColor?: string}}
  | {type: "setSpeed"; clipId: string; speed: number}
  | {type: "addText"; clipId: string; trackId: string; startFrame: number; durationInFrames: number; content: string}
  | {type: "updateText"; clipId: string; patch: TextPatch}
  | {type: "setTransition"; clipId: string; transition: NonNullable<Clip["transitionOut"]> | null}
  | {type: "detachAudio"; clipId: string; newClipId: string; trackId: string}
  | {type: "addMarker"; markerId: string; frame: number; label: string}
  | {type: "updateMarker"; markerId: string; patch: {frame?: number; label?: string}}
  | {type: "deleteMarker"; markerId: string};

export type CommandResult = {ok: true; project: Project; patches: Patch[]; inverse: Patch[]} | {ok: false; error: string};

export class CommandError extends Error {}
const fail = (msg: string): never => {
  throw new CommandError(msg);
};

// ---- lookups

export type Located = {track: Track; trackIndex: number; clip: Clip; clipIndex: number};

export function locate(p: Pick<Project, "tracks">, clipId: string): Located | null {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const track = p.tracks[ti]!;
    const ci = track.clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return {track, trackIndex: ti, clip: track.clips[ci]!, clipIndex: ci};
  }
  return null;
}

const must = (p: Project, id: string) => locate(p, id) ?? fail(`No clip ${id}`);
const trackById = (p: Project, id: string) => p.tracks.find((t) => t.id === id) ?? fail(`No track ${id}`);
const end = (c: Pick<Clip, "startFrame" | "durationInFrames">) => c.startFrame + c.durationInFrames;
const sortClips = (t: Track) => t.clips.sort((a, b) => a.startFrame - b.startFrame);
const usPerFrames = (frames: number, fps: number, speed: number) => Math.round((frames / fps) * speed * 1e6);

export function assetKind(p: Pick<Project, "assets">, clip: Pick<Clip, "assetId">): "video" | "audio" | "image" | null {
  return p.assets.find((a) => a.id === clip.assetId)?.type ?? null;
}

/** What a clip plays: its asset's type, except that a clip on an audio track is sound only (detached from a video). */
export function clipKind(p: Pick<Project, "assets">, clip: Pick<Clip, "assetId">, track: Pick<Track, "type">): "video" | "audio" | "image" | null {
  return track.type === "audio" ? "audio" : assetKind(p, clip);
}

/** Whether a clip of this kind may sit on a track: video and images on video tracks, audio on audio tracks. */
export function fits(kind: "video" | "audio" | "image" | null, track: Pick<Track, "type">): boolean {
  if (kind === "audio") return track.type === "audio";
  if (kind === "video" || kind === "image") return track.type === "video" || track.type === "image";
  return track.type === "text";
}

const markerById = (p: Project, id: string) => p.markers.find((m) => m.id === id) ?? fail("No such marker");
const markerFrame = (f: number) => (Number.isInteger(f) && f >= 0 ? f : fail("A marker needs a whole frame at or after 0"));
const sortMarkers = (p: Project) => p.markers.sort((a, b) => a.frame - b.frame);

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;

const HEX = /^#[0-9a-fA-F]{6}$/;
/** A title's style after a change, or a refusal naming what is wrong. */
function validText(t: Text): Text {
  const bad = (ok: boolean, what: string) => ok || fail(what);
  bad(t.fontFamily.trim().length > 0, "Pick a font");
  bad(Number.isFinite(t.fontSize) && t.fontSize >= 8 && t.fontSize <= 400, "Text size goes from 8 to 400");
  bad(HEX.test(t.color), "Not a colour");
  bad(t.background === undefined || HEX.test(t.background), "Not a colour");
  bad(t.stroke === undefined || (HEX.test(t.stroke.color) && t.stroke.width >= 0 && t.stroke.width <= 40), "Outline goes from 0 to 40");
  bad(t.shadow === undefined || (t.shadow.blur >= 0 && [t.shadow.x, t.shadow.y, t.shadow.blur].every(Number.isFinite)), "Shadow out of range");
  bad(Number.isFinite(t.lineHeight) && t.lineHeight >= 0.5 && t.lineHeight <= 3, "Line spacing goes from 0.5 to 3");
  bad(t.maxWidth === undefined || t.maxWidth > 0, "Width out of range");
  bad((t.enterPreset === undefined || isTextPreset(t.enterPreset)) && (t.exitPreset === undefined || isTextPreset(t.exitPreset)), "No such animation");
  return t;
}

// ---- transitions (centred on the cut; see transitionSpans in @studio/schema)

export const MIN_TRANSITION = 2;
export const MAX_TRANSITION_SECONDS = 2;

/** Untrimmed source, in timeline frames at the clip's speed, before its in point and after its out point. */
function handleFrames(p: Project, clip: Clip): {before: number; after: number} {
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset || clip.text) return {before: 0, after: 0};
  if (asset.type === "image") return {before: Infinity, after: Infinity};
  const f = (us: number) => Math.max(0, Math.floor((us / 1e6) * (p.fps / clip.speed) + 1e-3));
  return {before: f(clip.sourceStartUs), after: asset.durationUs === undefined ? 0 : f(asset.durationUs - clip.sourceStartUs - clip.sourceDurationUs)};
}

/**
 * The longest transition the cut after this clip can take, and why it can take none. The outgoing clip needs
 * ceil(d/2) frames of source past its out point, the incoming one floor(d/2) before its in point; neither half may be
 * longer than its clip (which also leaves a clip between two transitions room for both halves); at most 2 seconds.
 */
export function transitionRoom(p: Project, clipId: string): {max: number; reason: string | null} {
  const m = locate(p, clipId);
  if (!m) return {max: 0, reason: "No such clip"};
  const {track, clip, clipIndex} = m;
  if ((track.type !== "video" && track.type !== "image") || clip.text) return {max: 0, reason: "Transitions go between pictures"};
  const next = track.clips[clipIndex + 1];
  if (!next || next.startFrame !== end(clip)) return {max: 0, reason: "A transition needs a clip right after this one on the same track"};
  const a = handleFrames(p, clip);
  const b = handleFrames(p, next);
  const max = Math.min(2 * a.after, 2 * b.before + 1, clip.durationInFrames, next.durationInFrames, Math.round(MAX_TRANSITION_SECONDS * p.fps));
  return max >= MIN_TRANSITION ? {max, reason: null} : {max: 0, reason: "Not enough footage past the cut for a transition; trim the clips to leave some"};
}
export const maxTransition = (p: Project, clipId: string): number => transitionRoom(p, clipId).max;

/** After any edit: a transition that no longer fits shrinks to what does, or goes (in the same undo step). */
function fixTransitions(draft: Project): void {
  for (const t of draft.tracks)
    for (const c of t.clips) {
      if (!c.transitionOut) continue;
      const max = maxTransition(draft, c.id);
      if (max < MIN_TRANSITION) delete c.transitionOut;
      else if (c.transitionOut.durationInFrames > max) c.transitionOut.durationInFrames = max;
    }
}

/** Smallest part of the picture a crop may keep, per side: 5%. */
export const MIN_CROP = 0.05;
function validCrop(c: NonNullable<Clip["crop"]>): NonNullable<Clip["crop"]> {
  const ok = [c.x, c.y, c.width, c.height].every(Number.isFinite) && c.x >= 0 && c.y >= 0 && c.width >= MIN_CROP && c.height >= MIN_CROP && c.x + c.width <= 1 + 1e-9 && c.y + c.height <= 1 + 1e-9;
  return ok ? {x: c.x, y: c.y, width: c.width, height: c.height} : fail("The crop must stay inside the picture");
}

const unlocked = (t: Track) => !t.locked || fail("That track is locked");

// ---- moves

/** Where each moved clip lands: its track and new start. Null when the move breaks a rule. */
function placements(p: Project, clipIds: string[], delta: number, toTrackId?: string): {clip: Clip; from: Track; to: Track; start: number}[] | null {
  const moved = clipIds.map((id) => locate(p, id));
  if (moved.some((m) => !m)) return null;
  const located = moved as Located[];
  if (toTrackId && new Set(located.map((m) => m.track.id)).size > 1) return null; // a group from several tracks keeps its tracks
  const to = toTrackId ? p.tracks.find((t) => t.id === toTrackId) : undefined;
  if (toTrackId && !to) return null;
  const out = located.map((m) => ({clip: m.clip, from: m.track, to: to ?? m.track, start: m.clip.startFrame + delta}));
  const ids = new Set(clipIds);
  for (const o of out) {
    if (o.start < 0 || o.from.locked || o.to.locked || !fits(clipKind(p, o.clip, o.from), o.to)) return null;
    const e = o.start + o.clip.durationInFrames;
    if (o.to.clips.some((c) => !ids.has(c.id) && c.startFrame < e && end(c) > o.start)) return null;
  }
  return out;
}

export const canMove = (p: Project, clipIds: string[], delta: number, toTrackId?: string): boolean => placements(p, clipIds, delta, toTrackId) !== null;

/**
 * The legal move nearest to the one asked for: the asked delta if it is free, otherwise the closest delta that butts a
 * moved clip against a neighbour's edge (or against frame 0). Null if nothing fits. The timeline drag uses this, so a
 * clip dropped onto another slides to the nearest gap instead of refusing.
 */
export function resolveMove(p: Project, clipIds: string[], delta: number, toTrackId?: string): number | null {
  if (canMove(p, clipIds, delta, toTrackId)) return delta;
  const ids = new Set(clipIds);
  const moved = clipIds.map((id) => locate(p, id)).filter((m): m is Located => !!m);
  const candidates = new Set<number>();
  for (const m of moved) {
    const target = toTrackId ? p.tracks.find((t) => t.id === toTrackId) : m.track;
    if (!target) return null;
    candidates.add(-m.clip.startFrame);
    for (const c of target.clips) {
      if (ids.has(c.id)) continue;
      candidates.add(end(c) - m.clip.startFrame); // start where the neighbour ends
      candidates.add(c.startFrame - end(m.clip)); // end where the neighbour starts
    }
  }
  let best: number | null = null;
  for (const d of [...candidates].sort((a, b) => Math.abs(a - delta) - Math.abs(b - delta))) {
    if (canMove(p, clipIds, d, toTrackId)) {
      best = d;
      break;
    }
  }
  return best;
}

// ---- trims

/** Longest a clip may run from its current source start: the asset's remaining media (stills have no limit). */
function maxDuration(p: Project, clip: Clip): number {
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (!asset || asset.type === "image" || asset.durationUs === undefined) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(((asset.durationUs - clip.sourceStartUs) / 1e6) * (p.fps / clip.speed)));
}

/** The trim delta actually possible: one frame minimum, no further than the source media, the neighbours and frame 0. */
export function clampTrim(p: Project, clipId: string, edge: "start" | "end", delta: number): number {
  const m = locate(p, clipId);
  if (!m) return 0;
  const {clip, track} = m;
  const others = track.clips.filter((c) => c.id !== clip.id);
  if (edge === "end") {
    const next = others.filter((c) => c.startFrame >= end(clip)).reduce((a, c) => Math.min(a, c.startFrame), Number.MAX_SAFE_INTEGER);
    // A clip may already run up to half a frame past its source (durations are rounded to frames), so the source limit
    // can only stop an extension, never turn it into a shortening.
    const hi = Math.min(Math.max(0, maxDuration(p, clip) - clip.durationInFrames), next - end(clip));
    return Math.max(1 - clip.durationInFrames, Math.min(hi, delta)) || 0; // never -0
  }
  const prev = others.filter((c) => end(c) <= clip.startFrame).reduce((a, c) => Math.max(a, end(c)), 0);
  const asset = p.assets.find((a) => a.id === clip.assetId);
  // Extending the start reveals earlier source; a still has no source position to run out of.
  const sourceRoom = !asset || asset.type === "image" ? Number.MAX_SAFE_INTEGER : Math.round((clip.sourceStartUs / 1e6) * (p.fps / clip.speed)); // round: source offsets carry sub-microsecond rounding from earlier trims
  const lo = -Math.min(clip.startFrame - prev, sourceRoom);
  return Math.max(lo, Math.min(clip.durationInFrames - 1, delta)) || 0;
}

function setDuration(clip: Clip, frames: number, fps: number): void {
  clip.durationInFrames = frames;
  clip.sourceDurationUs = usPerFrames(frames, fps, clip.speed);
  clip.fadeInFrames = Math.min(clip.fadeInFrames, frames);
  clip.fadeOutFrames = Math.min(clip.fadeOutFrames, frames);
}

// ---- the commands

function run(draft: Project, cmd: Command): void {
  const fps = draft.fps;
  switch (cmd.type) {
    case "addAsset": {
      const asset = draft.assets.find((a) => a.id === cmd.assetId) ?? fail("No such media");
      // the first unlocked track of its kind; if every one is locked, a new track
      if (appendAssetClip(draft, asset, {clip: cmd.clipId, track: cmd.trackId}, (t) => !t.locked) === null) fail("This media is not ready yet");
      return;
    }
    case "moveClips": {
      if (cmd.clipIds.length === 0) return;
      const placed = placements(draft, cmd.clipIds, cmd.deltaFrames, cmd.toTrackId) ?? fail("Clips cannot overlap or move onto a locked or different kind of track");
      for (const o of placed) {
        o.clip.startFrame = o.start;
        if (o.to !== o.from) {
          o.from.clips.splice(o.from.clips.indexOf(o.clip), 1);
          o.to.clips.push(o.clip);
        }
      }
      for (const t of new Set(placed.flatMap((o) => [o.from, o.to]))) sortClips(t);
      return;
    }
    case "trimClip": {
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      const d = clampTrim(draft, cmd.clipId, cmd.edge, cmd.deltaFrames);
      if (d === 0) return;
      if (cmd.edge === "end") setDuration(clip, clip.durationInFrames + d, fps);
      else {
        const asset = draft.assets.find((a) => a.id === clip.assetId);
        clip.startFrame += d;
        if (asset && asset.type !== "image") clip.sourceStartUs = Math.max(0, clip.sourceStartUs + usPerFrames(d, fps, clip.speed));
        setDuration(clip, clip.durationInFrames - d, fps);
      }
      return;
    }
    case "splitClips": {
      let any = false;
      for (const id of cmd.clipIds) {
        const {clip, track} = must(draft, id);
        if (cmd.frame <= clip.startFrame || cmd.frame >= end(clip)) continue; // the playhead is not inside this clip
        unlocked(track);
        const newId = cmd.newIds[id] ?? fail("Split needs an id for the new clip");
        const asset = draft.assets.find((a) => a.id === clip.assetId);
        const head = cmd.frame - clip.startFrame;
        const tail: Clip = {...structuredClone(current(clip)), id: newId};
        tail.startFrame = cmd.frame;
        if (asset && asset.type !== "image") tail.sourceStartUs = clip.sourceStartUs + usPerFrames(head, fps, clip.speed);
        setDuration(tail, clip.durationInFrames - head, fps);
        tail.fadeInFrames = 0; // the cut is hard on both sides: the fade in stays with the head, the fade out with the tail
        clip.fadeOutFrames = 0;
        delete clip.transitionOut; // the transition belongs to the gap after the original clip, now after the tail
        setDuration(clip, head, fps);
        track.clips.splice(track.clips.indexOf(clip) + 1, 0, tail);
        any = true;
      }
      if (!any) fail("The playhead is not inside a clip");
      return;
    }
    case "deleteClips": {
      for (const id of cmd.clipIds) {
        const {track, clip} = must(draft, id);
        unlocked(track);
        track.clips.splice(track.clips.indexOf(clip), 1);
      }
      return;
    }
    case "duplicateClips": {
      if (cmd.clipIds.length === 0) return;
      const src = cmd.clipIds.map((id) => must(draft, id));
      for (const m of src) unlocked(m.track);
      // The copies keep their arrangement and land straight after the selection, or after the next gap that fits.
      const span = Math.max(...src.map((m) => end(m.clip))) - Math.min(...src.map((m) => m.clip.startFrame));
      const copies = src.map((m) => {
        const copy: Clip = {...structuredClone(current(m.clip)), id: cmd.newIds[m.clip.id] ?? fail("Duplicate needs new ids")};
        m.track.clips.push(copy);
        return {copy, track: m.track};
      });
      // Copies start on top of their originals; find the first free delta at or after the span.
      const ids = copies.map((c) => c.copy.id);
      const freeAt = (d: number) =>
        copies.every(({copy, track}) => track.clips.every((c) => ids.includes(c.id) || c.startFrame >= copy.startFrame + d + copy.durationInFrames || end(c) <= copy.startFrame + d));
      const options = [span, ...copies.flatMap(({copy, track}) => track.clips.filter((c) => !ids.includes(c.id)).map((c) => end(c) - copy.startFrame))]
        .filter((d) => d >= span)
        .sort((a, b) => a - b);
      const delta = options.find(freeAt) ?? fail("No room for the copy");
      for (const {copy, track} of copies) {
        copy.startFrame += delta;
        sortClips(track);
      }
      return;
    }
    case "updateClip": {
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      const {transform, crop, ...rest} = cmd.patch;
      if (transform) Object.assign(clip.transform, transform);
      Object.assign(clip, rest);
      if (crop === null || (crop && crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1)) delete clip.crop;
      else if (crop) clip.crop = validCrop(crop);
      const t = clip.transform;
      if (![t.x, t.y, t.scale, t.rotation, t.opacity, clip.volume].every(Number.isFinite)) fail("Value out of range");
      if (t.scale <= 0 || t.opacity < 0 || t.opacity > 1 || clip.volume < 0) fail("Value out of range");
      clip.fadeInFrames = Math.max(0, Math.min(Math.round(clip.fadeInFrames), clip.durationInFrames));
      clip.fadeOutFrames = Math.max(0, Math.min(Math.round(clip.fadeOutFrames), clip.durationInFrames));
      return;
    }
    case "addTrack": {
      if (draft.tracks.some((t) => t.id === cmd.trackId)) fail("Track id in use");
      const track: Track = {id: cmd.trackId, type: cmd.kind, muted: false, locked: false, visible: true, clips: []};
      // Default places: a new video track goes on top of the video tracks, an audio track below everything.
      const index = cmd.index ?? (cmd.kind === "video" ? 0 : draft.tracks.length);
      draft.tracks.splice(Math.max(0, Math.min(draft.tracks.length, index)), 0, track);
      return;
    }
    case "deleteTrack": {
      const track = trackById(draft, cmd.trackId);
      unlocked(track);
      draft.tracks.splice(draft.tracks.indexOf(track), 1);
      return;
    }
    case "moveTrack": {
      const track = trackById(draft, cmd.trackId);
      const from = draft.tracks.indexOf(track);
      const to = Math.max(0, Math.min(draft.tracks.length - 1, cmd.toIndex));
      if (from === to) return;
      draft.tracks.splice(from, 1);
      draft.tracks.splice(to, 0, track);
      return;
    }
    case "setTrack": {
      Object.assign(trackById(draft, cmd.trackId), cmd.patch);
      return;
    }
    case "setProject": {
      if (cmd.patch.name !== undefined) draft.name = cmd.patch.name;
      if (cmd.patch.backgroundColor !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(cmd.patch.backgroundColor)) fail("Not a colour");
        draft.backgroundColor = cmd.patch.backgroundColor;
      }
      return;
    }
    case "setSpeed": {
      // The clip keeps the same stretch of source and changes length; the later clips on its track follow (ripple).
      // sourceDurationUs is left as it is, so a slider dragged back and forth returns the exact clip it started from.
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      if (!(cmd.speed >= MIN_SPEED && cmd.speed <= MAX_SPEED)) fail("Speed goes from 0.5x to 2x");
      const asset = draft.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.type === "image") fail("A still has no speed; change its length by trimming");
      const oldEnd = end(clip);
      const frames = Math.max(1, Math.round((clip.sourceDurationUs / 1e6) * (fps / cmd.speed)));
      const delta = frames - clip.durationInFrames;
      clip.speed = cmd.speed;
      clip.durationInFrames = frames;
      clip.fadeInFrames = Math.min(clip.fadeInFrames, frames);
      clip.fadeOutFrames = Math.min(clip.fadeOutFrames, frames);
      if (delta) for (const c of track.clips) if (c.id !== clip.id && c.startFrame >= oldEnd) c.startFrame += delta;
      return;
    }
    case "addText": {
      // On the first unlocked text track with room, otherwise a new text track on top of everything.
      if (!Number.isInteger(cmd.startFrame) || cmd.startFrame < 0 || !Number.isInteger(cmd.durationInFrames) || cmd.durationInFrames < 1) fail("A title needs a start and a length");
      const s0 = cmd.startFrame;
      const e0 = s0 + cmd.durationInFrames;
      let to = draft.tracks.find((t) => t.type === "text" && !t.locked && t.clips.every((c) => end(c) <= s0 || c.startFrame >= e0));
      if (!to) {
        if (draft.tracks.some((t) => t.id === cmd.trackId)) fail("Track id in use");
        to = {id: cmd.trackId, type: "text", muted: false, locked: false, visible: true, clips: []};
        draft.tracks.unshift(to);
      }
      to.clips.push({
        id: cmd.clipId, startFrame: s0, durationInFrames: cmd.durationInFrames, sourceStartUs: 0, sourceDurationUs: 0, speed: 1,
        transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false}, fit: "contain", volume: 1, muted: false, fadeInFrames: 0, fadeOutFrames: 0,
        text: TextSchema.parse({content: cmd.content}),
      });
      sortClips(to);
      return;
    }
    case "updateText": {
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      if (!clip.text) fail("This clip is not a title");
      const t = clip.text!;
      for (const [k, v] of Object.entries(cmd.patch) as [keyof Text, unknown][]) {
        if (v === null) delete t[k];
        else if (v !== undefined) (t as Record<string, unknown>)[k] = v;
      }
      validText(current(t) as Text);
      return;
    }
    case "setTransition": {
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      if (cmd.transition === null) {
        delete clip.transitionOut;
        return;
      }
      const {kind, durationInFrames: d} = cmd.transition;
      if (!["fade", "slide", "wipe"].includes(kind)) fail("No such transition");
      const room = transitionRoom(draft, cmd.clipId);
      if (room.reason) fail(room.reason);
      if (!Number.isInteger(d) || d < MIN_TRANSITION || d > room.max) fail(`This cut takes a transition of at most ${room.max} frames`);
      clip.transitionOut = {kind, durationInFrames: d};
      return;
    }
    case "detachAudio": {
      const {clip, track} = must(draft, cmd.clipId);
      unlocked(track);
      const asset = draft.assets.find((a) => a.id === clip.assetId);
      if (track.type === "audio" || asset?.type !== "video") fail("Only a video clip's sound can be detached");
      if (asset!.audioChannels === 0) fail("This clip has no sound");
      const free = (t: Track) => t.type === "audio" && !t.locked && t.clips.every((c) => end(c) <= clip.startFrame || c.startFrame >= end(clip));
      let to = draft.tracks.find(free);
      if (!to) {
        if (draft.tracks.some((t) => t.id === cmd.trackId)) fail("Track id in use");
        to = {id: cmd.trackId, type: "audio", muted: false, locked: false, visible: true, clips: []};
        draft.tracks.push(to);
      }
      const snd: Clip = {...structuredClone(current(clip)), id: cmd.newClipId, muted: false};
      delete snd.transitionOut; // a transition is a picture change; the sound cuts
      delete snd.crop;
      to.clips.push(snd);
      sortClips(to);
      clip.muted = true;
      return;
    }
    case "addMarker": {
      if (draft.markers.some((m) => m.id === cmd.markerId)) fail("Marker id in use");
      draft.markers.push({id: cmd.markerId, frame: markerFrame(cmd.frame), label: cmd.label.trim()});
      sortMarkers(draft);
      return;
    }
    case "updateMarker": {
      const marker = markerById(draft, cmd.markerId);
      if (cmd.patch.label !== undefined) marker.label = cmd.patch.label.trim();
      if (cmd.patch.frame !== undefined && cmd.patch.frame !== marker.frame) {
        marker.frame = markerFrame(cmd.patch.frame);
        sortMarkers(draft);
      }
      return;
    }
    case "deleteMarker": {
      draft.markers.splice(draft.markers.indexOf(markerById(draft, cmd.markerId)), 1);
      return;
    }
  }
}

/** Apply a command. On failure the project is untouched and the error says why, in words the editor can show. */
export function applyCommand(project: Project, cmd: Command): CommandResult {
  if ("clipIds" in cmd) cmd = {...cmd, clipIds: [...new Set(cmd.clipIds)]}; // a repeated id would move or copy a clip twice
  try {
    const [next, patches, inverse] = produceWithPatches(project, (d) => {
      run(d as Project, cmd);
      fixTransitions(d as Project);
    });
    return {ok: true, project: next, patches, inverse};
  } catch (err) {
    if (err instanceof CommandError) return {ok: false, error: err.message};
    throw err;
  }
}
