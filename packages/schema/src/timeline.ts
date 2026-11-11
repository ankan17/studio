// Pure timeline helpers shared by the editor and (later) the exporter. Tracks are ordered top layer first: tracks[0] is
// drawn on top of tracks[1], matching how the timeline lists them.
import type {Asset, Clip, Project, Track} from "./index";

export const DEFAULT_IMAGE_SECONDS = 5;

export const secondsToFrames = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** Last frame (exclusive) used by any clip. Zero for an empty project. */
export function projectDurationFrames(project: Pick<Project, "tracks">): number {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, c.startFrame + c.durationInFrames);
  return end;
}

export const trackEndFrame = (track: Pick<Track, "clips">): number => track.clips.reduce((end, c) => Math.max(end, c.startFrame + c.durationInFrames), 0);

export const trackTypeFor = (asset: Pick<Asset, "type">): Track["type"] => (asset.type === "audio" ? "audio" : asset.type === "image" ? "image" : "video");

/** Whether an asset has what a clip needs (a duration for video and audio). */
export const canAppend = (asset: Asset): boolean => asset.type === "image" || (asset.durationUs ?? 0) > 0;

/**
 * Append an asset at the end of the first track of the right kind (creating it if there is none) and return the new
 * clip's id. Video clips share a track with images; `usable` can rule tracks out (the editor skips locked ones). Mutates the draft it is given (use inside an immer recipe).
 */
export function appendAssetClip(draft: Project, asset: Asset, ids: {clip: string; track: string}, usable: (t: Track) => boolean = () => true): string | null {
  if (!canAppend(asset)) return null;
  const kind = asset.type === "audio" ? "audio" : "video";
  let track = draft.tracks.find((t) => t.type === kind && usable(t));
  if (!track) {
    const created: Track = {id: ids.track, type: kind, muted: false, locked: false, visible: true, clips: []};
    // video above audio: new video tracks go to the top, audio tracks to the bottom
    if (kind === "video") draft.tracks.unshift(created);
    else draft.tracks.push(created);
    track = created;
  }
  const durationUs = asset.type === "image" ? DEFAULT_IMAGE_SECONDS * 1e6 : (asset.durationUs ?? 0);
  const clip: Clip = {
    id: ids.clip,
    assetId: asset.id,
    startFrame: trackEndFrame(track),
    durationInFrames: Math.max(1, secondsToFrames(durationUs / 1e6, draft.fps)),
    sourceStartUs: 0,
    sourceDurationUs: durationUs,
    speed: 1,
    transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false},
    fit: "contain",
    volume: 1,
    muted: false,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
  track.clips.push(clip);
  return clip.id;
}

/** The clip on each track that covers a frame, topmost track first. */
export function clipsAtFrame(project: Pick<Project, "tracks">, frame: number): {track: Track; clip: Clip}[] {
  const out: {track: Track; clip: Clip}[] = [];
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => frame >= c.startFrame && frame < c.startFrame + c.durationInFrames);
    if (clip) out.push({track, clip});
  }
  return out;
}

/** "HH:MM:SS:FF" (hours only when needed), the timecode an editor shows. */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const total = Math.floor(f / fps);
  const ff = String(f - total * fps).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}:${ff}` : `${String(m).padStart(2, "0")}:${s}:${ff}`;
}
