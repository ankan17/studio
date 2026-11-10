import {Player} from "@remotion/player";
import {useEffect, useState} from "react";
import {Hud} from "./Hud";
import type {MediaHandle} from "./ipc";
import {VideoComposition} from "./VideoComposition";

const FPS = 30;

export function App() {
  const [media, setMedia] = useState<MediaHandle | null>(null);
  const [frames, setFrames] = useState(FPS * 5);

  // Duration through mediabunny over media:// (also exercises Range reads).
  useEffect(() => {
    if (!media) return;
    let cancelled = false;
    void (async () => {
      const {Input, UrlSource, ALL_FORMATS} = await import("mediabunny");
      const input = new Input({source: new UrlSource(media.url), formats: ALL_FORMATS});
      const seconds = await input.computeDuration();
      if (!cancelled) setFrames(Math.max(1, Math.floor(seconds * FPS)));
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-center gap-3">
        <button className="rounded bg-sky-600 px-3 py-1" onClick={() => void window.studio.openMedia().then((h) => h && setMedia(h))}>
          Open video
        </button>
        <span className="text-sm text-zinc-400">{media ? `${media.name} (${media.sizeMB}MB)` : "No media loaded"}</span>
      </div>
      <Hud />
      {media && (
        <Player
          component={VideoComposition}
          inputProps={{src: media.url}}
          durationInFrames={frames}
          fps={FPS}
          compositionWidth={1920}
          compositionHeight={1080}
          controls
          style={{width: 800}}
        />
      )}
    </div>
  );
}
