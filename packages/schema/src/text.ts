// Title animation: the entrance and exit presets a text clip can have, as pure maths over the clip's own frame, so the
// preview and the export draw the same thing. The schema stores preset names as strings; an unknown name means none.
import type {z} from "zod";
import type {TextSchema} from "./index";

export const TEXT_PRESETS = ["none", "fade", "slideUp", "pop", "typewriter"] as const;
export type TextPreset = (typeof TEXT_PRESETS)[number];
export const isTextPreset = (v: unknown): v is TextPreset => TEXT_PRESETS.includes(v as TextPreset);

/** How long fade, slide up and pop take. Typewriter takes longer for longer text (see below). */
export const PRESET_SECONDS = 0.4;
/** Typewriter speed: characters (graphemes) per second, never past half the clip. */
const TYPE_RATE = 18;

let segmenter: Intl.Segmenter | null = null;
/** User-perceived characters. Indic conjuncts (ক্ষ, ত্র) stay whole, so typewriter never shows half a letter. */
export function graphemes(s: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, {granularity: "grapheme"});
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

export type TextFrame = {
  opacity: number;
  /** Vertical offset in em (multiply by the font size). */
  dy: number;
  scale: number;
  /** Graphemes shown, or null for all of them. */
  chars: number | null;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);

function length(preset: TextPreset, n: number, duration: number, fps: number): number {
  if (preset === "none") return 0;
  const base = Math.max(1, Math.round(PRESET_SECONDS * fps));
  return preset === "typewriter" ? Math.min(Math.floor(duration / 2), Math.max(base, Math.ceil((n * fps) / TYPE_RATE))) : base;
}

/** One preset at progress p (0 hidden, 1 fully shown). */
function apply(out: TextFrame, preset: TextPreset, p: number, n: number): void {
  if (preset === "fade") out.opacity *= p;
  else if (preset === "slideUp") {
    out.opacity *= p;
    out.dy += 0.6 * (1 - easeOut(p));
  } else if (preset === "pop") {
    out.opacity *= Math.min(1, p * 3);
    out.scale *= 0.6 + 0.4 * easeOutBack(p);
  } else if (preset === "typewriter" && p < 1) out.chars = Math.min(out.chars ?? n, Math.floor(n * p));
}

/** The title's look at `frame` (0-based, within the clip) of a clip `duration` frames long. */
export function textAnimation(text: Pick<z.infer<typeof TextSchema>, "content" | "enterPreset" | "exitPreset">, frame: number, duration: number, fps: number): TextFrame {
  const out: TextFrame = {opacity: 1, dy: 0, scale: 1, chars: null};
  const enter: TextPreset = isTextPreset(text.enterPreset) ? text.enterPreset : "none";
  const exit: TextPreset = isTextPreset(text.exitPreset) ? text.exitPreset : "none";
  if (enter === "none" && exit === "none") return out;
  const n = graphemes(text.content).length;
  let inLen = length(enter, n, duration, fps);
  let outLen = length(exit, n, duration, fps);
  if (inLen + outLen > duration) {
    // a short clip shares its length between the two
    inLen = Math.min(inLen, Math.floor(duration / 2));
    outLen = Math.min(outLen, Math.floor(duration / 2));
  }
  // progress reaches 1 on the last frame of the entrance, and 0 on the clip's last frame
  if (inLen > 1) apply(out, enter, clamp01(frame / (inLen - 1)), n);
  if (outLen > 1) apply(out, exit, clamp01((duration - 1 - frame) / (outLen - 1)), n);
  if (out.chars !== null && out.chars >= n) out.chars = null;
  return out;
}
