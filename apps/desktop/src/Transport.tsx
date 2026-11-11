import {timecode} from "@studio/schema";
import {useEditor} from "./editorStore";
import {Loop, Pause, Play, SkipEnd, SkipStart, StepBack, StepFwd} from "./icons";
import {playback, usePlayback} from "./playback";

export function Transport() {
  const fps = useEditor((s) => s.project!.fps);
  const width = useEditor((s) => s.project!.width);
  const height = useEditor((s) => s.project!.height);
  const {frame, playing, loop, duration} = usePlayback();
  const empty = duration === 0;
  const second = fps;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pb-1 pt-2">
      <div className="flex items-baseline gap-2" data-testid="timecode">
        <span className="mono text-[17px] font-medium tracking-tight">{timecode(frame, fps)}</span>
        <span className="mono text-xs text-faint">/ {timecode(duration, fps)}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn" title="Go to start (Home)" disabled={empty} onClick={playback.toStart}><SkipStart /></button>
        <button className="icon-btn" title="Back one frame (←)" disabled={empty} onClick={() => playback.step(-1)}><StepBack /></button>
        <button
          className="mx-1 grid h-9 w-9 place-items-center rounded-full bg-[#ecedf0] text-[#0e0f11] shadow-[0_2px_10px_rgb(0_0_0/0.4)] transition hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
          title="Play / pause (Space)"
          data-testid="play"
          aria-pressed={playing}
          disabled={empty}
          onClick={playback.toggle}
        >
          {playing ? <Pause size={16} /> : <span className="translate-x-[1px]"><Play size={16} /></span>}
        </button>
        <button className="icon-btn" title="Forward one frame (→)" disabled={empty} onClick={() => playback.step(1)}><StepFwd /></button>
        <button className="icon-btn" title="Go to end (End)" disabled={empty} onClick={playback.toEnd}><SkipEnd /></button>
      </div>
      <div className="flex items-center justify-end gap-3 text-xs text-faint">
        <span className="hidden gap-1 xl:flex"><span className="kbd">Space</span> play <span className="kbd">←</span><span className="kbd">→</span> frame <span className="kbd">⇧</span> {second}f</span>
        <button className={`icon-btn ${loop ? "!bg-accent-soft !text-accent" : ""}`} title="Loop" aria-pressed={loop} onClick={playback.toggleLoop}><Loop /></button>
        <span className="mono rounded-md border border-line px-2 py-1 text-[11px] text-dim">{width}×{height} · {fps}</span>
      </div>
    </div>
  );
}
