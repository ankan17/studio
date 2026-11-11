import {Player, type PlayerRef} from "@remotion/player";
import {projectDurationFrames} from "@studio/schema";
import {useEffect, useMemo, useRef} from "react";
import {ProjectComposition, type EngineProps} from "./engine/ProjectComposition";
import {useEditor} from "./editorStore";
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
    <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[6px] bg-ground" style={{containerType: "size"}} data-testid="stage">
      <div
        className="relative overflow-hidden bg-frame"
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
          <div className="absolute inset-0 grid place-items-center bg-frame p-6 text-center">
            <div className="grid max-w-[34ch] justify-items-center gap-1.5">
              <div className="text-heading font-semibold">Nothing on the timeline yet</div>
              <p className="m-0 text-body text-ink-2">Import media, then press + on a clip, or double-click it, to add it here.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
