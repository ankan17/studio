import {Player, type PlayerRef} from "@remotion/player";
import {projectDurationFrames} from "@studio/schema";
import {useEffect, useMemo, useRef} from "react";
import {ProjectComposition, type EngineProps} from "./engine/ProjectComposition";
import {useEditor} from "./editorStore";
import {Film} from "./icons";
import {attachPlayer, setDuration, usePlayback} from "./playback";

/** The preview: the project composition in a Remotion Player, scaled to fit while keeping the project's aspect ratio. */
export function Stage() {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const loop = usePlayback((s) => s.loop);
  const ref = useRef<PlayerRef>(null);
  const total = projectDurationFrames(project);
  const ratio = project.width / project.height;
  const inputProps = useMemo<EngineProps>(() => ({project, baseUrl, mode: "preview"}), [project, baseUrl]);

  useEffect(() => setDuration(total), [total]);
  useEffect(() => {
    attachPlayer(ref.current);
    return () => attachPlayer(null);
  }, []);

  return (
    <div className="relative grid min-h-0 flex-1 place-items-center" style={{containerType: "size"}} data-testid="stage">
      <div
        className="relative overflow-hidden rounded-[6px] bg-black shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_60px_-12px_rgb(0_0_0/0.7)]"
        style={{aspectRatio: String(ratio), width: `min(100cqw, calc(100cqh * ${ratio}))`}}
        data-testid="preview"
      >
        <Player
          ref={ref}
          component={ProjectComposition}
          inputProps={inputProps}
          durationInFrames={Math.max(1, total)}
          fps={project.fps}
          compositionWidth={project.width}
          compositionHeight={project.height}
          loop={loop}
          controls={false}
          clickToPlay={false}
          style={{width: "100%", height: "100%"}}
        />
        {total === 0 && (
          <div className="rise absolute inset-0 grid place-items-center text-center" style={{background: "radial-gradient(circle at 50% 40%, rgb(255 255 255 / 0.04), transparent 70%)"}}>
            <div className="grid justify-items-center gap-2 text-dim">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-raised"><Film size={18} /></span>
              <div className="text-[13px] font-medium text-ink">Nothing on the timeline yet</div>
              <div className="max-w-[260px] text-xs text-faint">Import media, then press + on a clip to add it here.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
