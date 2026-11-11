// Transitions on the timeline: a transition belongs to the cut between a clip and the clip right after it on the same
// track, and is centred on that cut. The outgoing clip plays on for ceil(d/2) frames past the cut and the incoming
// one starts floor(d/2) frames early, each using untrimmed source (handles) on that side. Clip positions never move.
// Validity (handles, lengths) is kept by the editing commands; this only reads what the project says.
import type {Clip, Track} from "./index";

export type TransitionKind = NonNullable<Clip["transitionOut"]>["kind"];
export const TRANSITION_KINDS: TransitionKind[] = ["fade", "slide", "wipe"];

export type Span = {
  /** Frames the clip plays before its start (the incoming half of a transition). */
  lead: number;
  /** Frames it plays after its end (the outgoing half). */
  tail: number;
  in: {kind: TransitionKind; frames: number} | null;
  out: {kind: TransitionKind; frames: number} | null;
};

/** How each clip on a track runs into its neighbours. Clips are sorted and never overlap. */
export function transitionSpans(track: Pick<Track, "clips">): Map<string, Span> {
  const out = new Map<string, Span>(track.clips.map((c) => [c.id, {lead: 0, tail: 0, in: null, out: null}]));
  track.clips.forEach((a, i) => {
    const b = track.clips[i + 1];
    const t = a.transitionOut;
    if (!t || !b || b.startFrame !== a.startFrame + a.durationInFrames || t.durationInFrames < 2) return;
    const sa = out.get(a.id)!;
    const sb = out.get(b.id)!;
    sa.tail = Math.ceil(t.durationInFrames / 2);
    sa.out = {kind: t.kind, frames: t.durationInFrames};
    sb.lead = Math.floor(t.durationInFrames / 2);
    sb.in = {kind: t.kind, frames: t.durationInFrames};
  });
  return out;
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/**
 * The incoming or outgoing clip's look at progress p (0 to 1) through a transition. Fade is a dissolve (the incoming
 * clip fades in over the outgoing one); slide pushes the outgoing clip out to the left; wipe reveals the incoming clip
 * from the left. All three are plain CSS the web renderer draws (opacity, transform, clip-path inset).
 */
export function transitionLook(kind: TransitionKind, p: number, role: "in" | "out"): {opacity?: number; transform?: string; clipPath?: string} {
  const e = ease(Math.min(1, Math.max(0, p)));
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  if (kind === "fade") return role === "in" ? {opacity: e} : {};
  if (kind === "slide") return {transform: `translateX(${role === "in" ? pct(1 - e) : pct(-e)})`};
  return role === "in" ? {clipPath: `inset(0 ${pct(1 - e)} 0 0)`} : {};
}
