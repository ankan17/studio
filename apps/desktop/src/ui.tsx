// Shared marks of the Metro-line system.
import type {Asset} from "@studio/schema";

export type LineKind = Asset["type"] | "text";

/** Media type to its line colour and letter. The same mapping everywhere: media panel, inspector, timeline. */
export const LINE: Record<LineKind, {color: string; letter: string; name: string}> = {
  video: {color: "var(--color-video)", letter: "V", name: "Video"},
  audio: {color: "var(--color-audio)", letter: "A", name: "Audio"},
  image: {color: "var(--color-still)", letter: "I", name: "Image"},
  text: {color: "var(--color-still)", letter: "T", name: "Title"}, // titles share the stills line (DESIGN.md)
};

/** A line roundel: the media type's colour with its letter. */
export function Roundel({kind, className = ""}: {kind: LineKind; className?: string}) {
  const line = LINE[kind];
  return (
    <span className={`roundel ${className}`} style={{background: line.color}} title={line.name} aria-label={line.name}>
      {line.letter}
    </span>
  );
}

/** Seconds as m:ss for durations. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
