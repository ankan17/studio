// The route timeline: each track is a coloured line (its media type), clips sit on it, cuts are station ticks, and a
// cut that lines up across tracks is an interchange ring. Read-only for now apart from scrubbing and selecting a clip;
// M4 adds trimming, zoom and snapping (the interchanges become snap points).
import {projectDurationFrames, timecode, type Clip, type Track} from "@studio/schema";
import {useMemo, useRef, useState} from "react";
import {useEditor} from "./editorStore";
import {playback, usePlayback} from "./playback";
import {LINE, Roundel, clock, type LineKind} from "./ui";

const LABEL_W = 112;
const PAD = 14;
const ROW_H = 60;
const HEAD_H = 36;
const RULER_H = 26;
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** A track's line: its type when every clip agrees, otherwise the type of its first clip's asset. */
function trackKind(t: Track, kindOf: (c: Clip) => LineKind): LineKind {
  return t.clips[0] ? kindOf(t.clips[0]) : t.type === "audio" ? "audio" : t.type === "image" ? "image" : "video";
}

function ClipBlock({clip, kind, left, width, selected}: {clip: Clip; kind: LineKind; left: number; width: number; selected: boolean}) {
  const asset = useEditor((s) => s.project!.assets.find((a) => a.id === clip.assetId));
  const baseUrl = useEditor((s) => s.baseUrl);
  const color = LINE[kind].color;
  const thumb = asset && asset.type !== "audio" ? `url(${baseUrl}/cache/${asset.sha256}.thumb.jpg)` : undefined;
  return (
    <div
      className={`absolute bottom-[7px] top-[7px] overflow-hidden rounded-[5px] border border-[rgb(234_237_242/0.1)] ${selected ? "outline-2 outline-offset-1 outline-go" : ""}`}
      style={{left, width: Math.max(2, width - 2), background: `color-mix(in srgb, ${color} 20%, var(--color-surface))`}}
      data-testid="clip-block"
      data-clip={clip.id}
    >
      {thumb && <div className="absolute inset-0 opacity-50" style={{backgroundImage: thumb, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x"}} />}
      {kind === "audio" && <div className="absolute inset-x-1.5 bottom-2 top-5 opacity-60" style={{background: `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 4px)`, maskImage: "linear-gradient(180deg, transparent, var(--color-ink) 30%, var(--color-ink) 70%, transparent)"}} />}
      <div className="relative truncate px-2 pt-1 text-[11px] font-medium leading-[14px] text-ink [text-shadow:0_1px_2px_var(--color-ground)]">{asset?.name ?? "Missing file"}</div>
      <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{background: color}} />
    </div>
  );
}

export function SequenceStrip() {
  const project = useEditor((s) => s.project)!;
  const selectedId = useEditor((s) => s.selectedClipId);
  const selectClip = useEditor((s) => s.selectClip);
  const frame = usePlayback((s) => s.frame);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const total = projectDurationFrames(project);
  const fps = project.fps;
  const span = Math.max(total * 1.06, fps * 12); // at least 12 seconds, so a short edit does not stretch
  const inner = Math.max(100, width - LABEL_W - PAD * 2);
  const px = inner / span;
  const tickS = STEPS_S.find((s) => s * fps * px >= 84) ?? 3600;
  const ticks = Array.from({length: Math.floor(span / (tickS * fps)) + 1}, (_, i) => i * tickS * fps);
  const kindOf = (c: Clip): LineKind => project.assets.find((a) => a.id === c.assetId)?.type ?? "video";
  const clipCount = project.tracks.reduce((n, t) => n + t.clips.length, 0);

  // Cuts per track (inner clip boundaries); a frame cut on two or more tracks is an interchange.
  const {cuts, interchanges} = useMemo(() => {
    const per = project.tracks.map((t) => {
      const set = new Set<number>();
      for (const c of t.clips) {
        if (c.startFrame > 0) set.add(c.startFrame);
        const end = c.startFrame + c.durationInFrames;
        if (t.clips.some((o) => o.startFrame === end)) set.add(end);
      }
      return set;
    });
    const count = new Map<number, number>();
    for (const s of per) for (const f of s) count.set(f, (count.get(f) ?? 0) + 1);
    return {cuts: per, interchanges: [...count].filter(([, n]) => n >= 2).map(([f]) => f)};
  }, [project.tracks]);

  const seekFromPointer = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    playback.seek((clientX - r.left - LABEL_W - PAD) / px);
  };
  const resumeAfter = useRef(false);
  const tracksTop = HEAD_H + RULER_H;

  return (
    <div
      ref={(el) => {
        box.current = el;
        if (el && Math.abs(el.clientWidth - width) > 1) setWidth(el.clientWidth);
      }}
      className="panel relative select-none overflow-hidden"
      style={{height: tracksTop + Math.max(1, project.tracks.length) * ROW_H + 2}}
      data-testid="sequence"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
        selectClip(hit?.dataset.clip ?? null);
        if ((e.target as HTMLElement).closest("[data-timeline-head]")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        resumeAfter.current = usePlayback.getState().playing;
        playback.pause();
        seekFromPointer(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seekFromPointer(e.clientX)}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (resumeAfter.current) playback.play();
      }}
    >
      <div className="flex items-center gap-2 border-b border-line-soft px-3.5" style={{height: HEAD_H}} data-timeline-head>
        <h2 className="text-heading font-semibold">Timeline</h2>
        {clipCount > 0 && <span className="tnum text-caption text-ink-3">{clipCount} {clipCount === 1 ? "clip" : "clips"} · {clock(total / fps)}</span>}
      </div>
      {/* ruler */}
      <div className="relative border-b border-line-soft" style={{height: RULER_H}}>
        {ticks.filter((f) => {
          const x = LABEL_W + PAD + f * px;
          const head = LABEL_W + PAD + frame * px;
          return x + 36 <= width - 4 && !(x > head - 40 && x < head + 92); // fits the panel, clear of the playhead readout
        }).map((f) => (
          <span key={f} className="num absolute top-[5px] border-l border-line pl-1.5 text-[10.5px] leading-[14px] text-ink-3" style={{left: LABEL_W + PAD + f * px}}>
            {clock(f / fps)}
          </span>
        ))}
      </div>
      {/* tracks */}
      {project.tracks.length === 0 && (
        <div className="grid place-items-center text-body text-ink-2" style={{height: ROW_H}}>Your timeline is empty. Clips you add appear here, in order.</div>
      )}
      {project.tracks.map((t, i) => {
        const kind = trackKind(t, kindOf);
        const n = project.tracks.filter((x, j) => j <= i && x.type === t.type).length;
        const tag = `${t.type === "audio" ? "A" : "V"}${n}`;
        return (
          <div key={t.id} className="relative flex border-b border-line-soft last:border-0" style={{height: ROW_H}} data-testid="track">
            <div className="flex shrink-0 items-center gap-2 pl-3.5" style={{width: LABEL_W}}>
              <Roundel kind={kind} />
              <span className="tag text-ink-2">{tag}</span>
              <span className="text-caption text-ink-3">{t.type === "audio" ? "Audio" : "Video"}</span>
            </div>
            <div className="relative flex-1" style={{marginLeft: PAD, marginRight: PAD}}>
              <div className="absolute inset-x-0 top-1/2 -mt-[2px] h-1 rounded-full opacity-70" style={{background: LINE[kind].color, marginLeft: -PAD}} />
              {t.clips.map((c) => (
                <ClipBlock key={c.id} clip={c} kind={kindOf(c)} left={c.startFrame * px} width={c.durationInFrames * px} selected={c.id === selectedId} />
              ))}
              {[...cuts[i]!].filter((f) => !interchanges.includes(f)).map((f) => (
                <span key={f} className="pointer-events-none absolute bottom-[2px] top-[2px] z-[2] w-[4px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{left: f * px}} />
              ))}
            </div>
          </div>
        );
      })}
      {/* interchanges: a cut on two or more tracks */}
      {interchanges.map((f) => (
        <span key={f} className="pointer-events-none absolute z-[3] w-[14px] -translate-x-1/2 rounded-[7px] border-[3px] border-ink bg-surface/50 ring-2 ring-surface" style={{left: LABEL_W + PAD + f * px, top: tracksTop + 2, bottom: 2}} title="Cuts line up across tracks" />
      ))}
      {/* playhead: you are here */}
      <div className="pointer-events-none absolute bottom-0 z-10 w-0" style={{left: LABEL_W + PAD + frame * px, top: HEAD_H}} data-testid="playhead">
        <div className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-go" />
        <div className="absolute h-[14px] w-[14px] -translate-x-1/2 rounded-full bg-go ring-[3px] ring-surface" style={{top: RULER_H - 7}} />
        <div className="num absolute left-[10px] top-[4px] whitespace-nowrap rounded-[4px] bg-go px-1.5 text-[10.5px] font-medium leading-4 text-go-ink">{timecode(frame, fps)}</div>
      </div>
    </div>
  );
}
