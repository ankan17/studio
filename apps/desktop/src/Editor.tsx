import {Player} from "@remotion/player";
import {useEffect, useRef, useState} from "react";
import {useEditor} from "./editorStore";
import {Hud} from "./Hud";
import type {MediaHandle} from "./ipc";
import {VideoComposition} from "./VideoComposition";

const SAVE_LABEL = {saved: "All changes saved", dirty: "Unsaved changes…", saving: "Saving…", error: "Save failed"} as const;

// Draws the video frame currently shown in the preview to a small JPEG and stores it as the project thumbnail.
async function captureThumbnail(container: HTMLElement | null, projectId: string): Promise<void> {
  const video = container?.querySelector("video");
  if (!video) return;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth) || 180;
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
  if (blob) await window.studio.projects.setThumbnail(projectId, new Uint8Array(await blob.arrayBuffer()));
}

export function Editor() {
  const {project, recovered, saveState, error, update, close} = useEditor();
  const [media, setMedia] = useState<MediaHandle | null>(null);
  const [frames, setFrames] = useState(150);
  const playerBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    void (async () => {
      const {Input, UrlSource, ALL_FORMATS} = await import("mediabunny");
      const seconds = await new Input({source: new UrlSource(media.url), formats: ALL_FORMATS}).computeDuration();
      if (!cancelled && project) setFrames(Math.max(1, Math.floor(seconds * project.fps)));
    })();
    return () => {
      cancelled = true;
    };
  }, [media, project?.fps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  return (
    <div className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded bg-zinc-700 px-3 py-1" onClick={() => void close()}>‹ Projects</button>
        <input
          className="rounded bg-zinc-800 px-2 py-1 text-lg font-semibold"
          value={project.name}
          onChange={(e) => update((p) => void (p.name = e.target.value))}
          onBlur={(e) => !e.target.value.trim() && update((p) => void (p.name = "Untitled"))}
        />
        <span className={`text-sm ${saveState === "error" ? "text-red-400" : "text-zinc-400"}`} title={error ?? undefined}>{SAVE_LABEL[saveState]}</span>
        <span className="text-sm text-zinc-500">{project.width} x {project.height} · {project.fps} fps</span>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          Background
          <input type="color" value={project.backgroundColor} onChange={(e) => update((p) => void (p.backgroundColor = e.target.value))} />
        </label>
      </div>
      {recovered && <div className="rounded bg-amber-900 p-2 text-sm">This project was restored from a recovery copy because its main file was damaged.</div>}
      <Hud />
      <div className="flex items-center gap-3">
        <button className="rounded bg-sky-600 px-3 py-1" onClick={() => void window.studio.openMedia().then((h) => h && setMedia(h))}>Preview a video</button>
        {media && (
          <>
            <span className="text-sm text-zinc-400">{media.name} ({media.sizeMB}MB)</span>
            <button className="rounded bg-zinc-700 px-3 py-1" onClick={() => void captureThumbnail(playerBox.current, project.id)}>Use current frame as thumbnail</button>
          </>
        )}
      </div>
      <div ref={playerBox}>
        {media && (
          <Player component={VideoComposition} inputProps={{src: media.url}} durationInFrames={frames} fps={project.fps} compositionWidth={project.width} compositionHeight={project.height} controls style={{width: 800}} />
        )}
      </div>
    </div>
  );
}
