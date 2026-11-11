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
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center pt-2.5">
      <div className="num flex items-baseline gap-1.5 whitespace-nowrap" data-testid="timecode">
        <span className="text-[16px] font-medium leading-5">{timecode(frame, fps)}</span>
        <span className="text-caption text-ink-3">/ {timecode(duration, fps)}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn" title="Go to start (Home)" aria-label="Go to start" disabled={empty} onClick={playback.toStart}><SkipStart /></button>
        <button className="icon-btn" title="Back one frame (←)" aria-label="Back one frame" disabled={empty} onClick={() => playback.step(-1)}><StepBack /></button>
        <button
          className="mx-1.5 grid h-[38px] w-[38px] place-items-center rounded-full bg-go text-go-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-go-hi active:scale-95 disabled:bg-raised disabled:text-ink-3"
          title="Play or pause (Space)"
          aria-label={playing ? "Pause" : "Play"}
          data-testid="play"
          aria-pressed={playing}
          disabled={empty}
          onClick={playback.toggle}
        >
          {playing ? <Pause size={16} /> : <span className="translate-x-[1px]"><Play size={16} /></span>}
        </button>
        <button className="icon-btn" title="Forward one frame (→)" aria-label="Forward one frame" disabled={empty} onClick={() => playback.step(1)}><StepFwd /></button>
        <button className="icon-btn" title="Go to end (End)" aria-label="Go to end" disabled={empty} onClick={playback.toEnd}><SkipEnd /></button>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button className="icon-btn" title="Loop playback" aria-label="Loop" aria-pressed={loop} onClick={playback.toggleLoop}><Loop /></button>
        <span className="num whitespace-nowrap rounded-[5px] border border-line px-2 py-[3px] text-caption text-ink-2">{width}×{height} · {fps} fps</span>
      </div>
    </div>
  );
}
