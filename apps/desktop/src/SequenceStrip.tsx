// A read-only view of the sequence for M3: tracks, clips, ruler and a draggable playhead. M4 turns this into the full
// timeline (zoom, editing, snapping); the layout and scrub behaviour are the part that carries over.
import {projectDurationFrames, timecode, type Clip, type Track} from "@studio/schema";
import {useRef, useState} from "react";
import {useEditor} from "./editorStore";
import {Film, Music, Picture} from "./icons";
import {playback, usePlayback} from "./playback";

const LABEL_W = 64;
const PAD = 14;
const ROW_H = 44;
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const HUE = {video: "var(--color-video)", audio: "var(--color-audio)", image: "var(--color-still)"} as const;

function trackIcon(t: Track) {
  return t.type === "audio" ? <Music size={13} /> : t.type === "image" ? <Picture size={13} /> : <Film size={13} />;
}

function ClipBlock({clip, left, width}: {clip: Clip; left: number; width: number}) {
  const asset = useEditor((s) => s.project!.assets.find((a) => a.id === clip.assetId));
  const baseUrl = useEditor((s) => s.baseUrl);
  const hue = HUE[asset?.type ?? "video"];
  const thumb = asset && asset.type !== "audio" ? `url(${baseUrl}/cache/${asset.sha256}.thumb.jpg)` : "none";
  return (
    <div
      className="absolute top-[3px] bottom-[3px] overflow-hidden rounded-[6px] border border-white/10"
      style={{left, width: Math.max(2, width - 1), background: `linear-gradient(90deg, color-mix(in srgb, ${hue} 38%, #14151a), color-mix(in srgb, ${hue} 22%, #14151a))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 35%, transparent)`}}
      data-testid="clip-block"
    >
      <div className="absolute inset-0 opacity-30" style={{backgroundImage: thumb, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x", mixBlendMode: "luminosity"}} />
      <div className="relative truncate px-2 pt-1 text-[11px] font-medium leading-tight text-white/90">{asset?.name ?? "Missing asset"}</div>
    </div>
  );
}

export function SequenceStrip() {
  const project = useEditor((s) => s.project)!;
  const frame = usePlayback((s) => s.frame);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const total = projectDurationFrames(project);
  const fps = project.fps;
  const span = Math.max(total * 1.06, fps * 12); // always show at least 12 seconds so a short clip does not stretch
  const inner = Math.max(100, width - LABEL_W - PAD * 2);
  const px = inner / span;
  const tickS = STEPS_S.find((s) => s * fps * px >= 84) ?? 3600;
  const ticks = Array.from({length: Math.floor(span / (tickS * fps)) + 1}, (_, i) => i * tickS * fps);

  const seekFromPointer = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    playback.seek((clientX - r.left - LABEL_W - PAD) / px);
  };
  const resumeAfter = useRef(false);

  return (
    <div
      ref={(el) => {
        box.current = el;
        if (el && Math.abs(el.clientWidth - width) > 1) setWidth(el.clientWidth);
      }}
      className="panel relative mx-3 mb-3 select-none overflow-hidden"
      style={{height: 28 + Math.max(1, project.tracks.length) * ROW_H + 10, minHeight: 112}}
      data-testid="sequence"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        resumeAfter.current = usePlayback.getState().playing;
        playback.pause();
        seekFromPointer(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seekFromPointer(e.clientX)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (resumeAfter.current) playback.play();
      }}
    >
      {/* ruler */}
      <div className="relative h-7 border-b border-line">
        {ticks.map((f) => (
          <div key={f} className="absolute bottom-0 top-0" style={{left: LABEL_W + PAD + f * px}}>
            <div className="absolute bottom-0 h-[7px] w-px bg-line-strong" />
            <span className="mono absolute left-1.5 top-[5px] text-[10px] text-faint">{timecode(f, fps).replace(/:\d\d$/, "")}</span>
          </div>
        ))}
      </div>
      {/* tracks */}
      <div className="relative">
        {project.tracks.length === 0 && (
          <div className="grid h-[54px] place-items-center text-xs text-faint">Your sequence is empty. Clips you add appear here, in order.</div>
        )}
        {project.tracks.map((t, i) => (
          <div key={t.id} className="relative flex border-b border-line/60 last:border-0" style={{height: ROW_H}} data-testid="track">
            <div className="flex shrink-0 items-center gap-1.5 pl-3 text-faint" style={{width: LABEL_W}}>
              {trackIcon(t)}
              <span className="mono text-[10.5px]">{t.type === "audio" ? "A" : "V"}{project.tracks.filter((x, j) => j <= i && x.type === t.type).length}</span>
            </div>
            <div className="relative flex-1" style={{marginRight: PAD}}>
              {t.clips.map((c) => (
                <ClipBlock key={c.id} clip={c} left={c.startFrame * px} width={c.durationInFrames * px} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* playhead */}
      <div className="pointer-events-none absolute bottom-0 top-0 z-10" style={{left: LABEL_W + PAD + frame * px}} data-testid="playhead">
        <div className="absolute -left-[5px] top-[3px] h-[10px] w-[11px] bg-accent" style={{clipPath: "polygon(0 0, 100% 0, 50% 100%)"}} />
        <div className="absolute bottom-0 top-[10px] w-px -translate-x-1/2 bg-accent shadow-[0_0_6px_rgb(255_106_61/0.6)]" />
      </div>
    </div>
  );
}
