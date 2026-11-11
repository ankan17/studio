// The one composition both preview and export draw (the plan's "same composition and same media tags in both").
// Built from the project JSON. Each clip is its own memoised layer, so editing one clip re-renders only that clip,
// and a Sequence with `premountFor` (absolute-fill layout only) mounts it two seconds early and unmounts it after it ends: only clips near the
// playhead exist in the DOM.
import type {Asset, Clip, Project, Track} from "@studio/schema";
import {Audio, Video} from "@remotion/media";
import {memo, useMemo} from "react";
import {AbsoluteFill, Img, Sequence} from "remotion";

export type EngineProps = {
  project: Project;
  /** Preview plays 720p proxies; export plays the originals. */
  mode: "preview" | "export";
  /** media:// URL of the project folder (assets and proxies are served beneath it). */
  baseUrl: string;
};

export const PREMOUNT_SECONDS = 2;

export function assetUrl(baseUrl: string, asset: Asset, mode: EngineProps["mode"]): string {
  const rel = mode === "preview" && asset.type === "video" && asset.proxyPath ? asset.proxyPath : asset.relativePath;
  return `${baseUrl}/${rel}`;
}

const usFrames = (us: number, fps: number) => Math.round((us / 1e6) * fps);

function transformCss(t: Clip["transform"]): string {
  return `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.flipH ? -t.scale : t.scale}, ${t.scale})`;
}

/** Volume over the clip, with linear fade in and out (frames are relative to the clip's start). */
function volumeFn(clip: Clip, muted: boolean) {
  if (muted) return 0;
  const {fadeInFrames: fi, fadeOutFrames: fo, durationInFrames: d, volume} = clip;
  if (!fi && !fo) return volume;
  return (f: number) => volume * Math.min(1, fi ? f / fi : 1, fo ? (d - f) / fo : 1);
}

type LayerProps = {clip: Clip; asset: Asset; src: string; fps: number; muted: boolean};

const MediaLayer = memo(function MediaLayer({clip, asset, src, fps, muted}: LayerProps) {
  const premountFor = Math.round(PREMOUNT_SECONDS * fps);
  const trimBefore = usFrames(clip.sourceStartUs, fps);
  const fill = {width: "100%", height: "100%"} as const; // explicit size: without it a portrait clip is cropped
  if (asset.type === "audio") {
    return (
      <Sequence from={clip.startFrame} durationInFrames={clip.durationInFrames} premountFor={premountFor}>
        <Audio src={src} trimBefore={trimBefore} playbackRate={clip.speed} volume={volumeFn(clip, muted)} />
      </Sequence>
    );
  }
  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationInFrames} premountFor={premountFor}>
      <AbsoluteFill style={{transform: transformCss(clip.transform), opacity: clip.transform.opacity}}>
        {asset.type === "video" ? (
          <Video src={src} trimBefore={trimBefore} playbackRate={clip.speed} volume={volumeFn(clip, muted)} objectFit={clip.fit} style={fill} />
        ) : (
          <Img src={src} style={{...fill, objectFit: clip.fit}} />
        )}
      </AbsoluteFill>
    </Sequence>
  );
});

const TrackLayers = memo(function TrackLayers({track, assets, baseUrl, mode, fps}: {track: Track; assets: Map<string, Asset>; baseUrl: string; mode: EngineProps["mode"]; fps: number}) {
  return (
    <>
      {track.clips.map((clip) => {
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
        if (!asset) return null; // text clips arrive in M5; a clip whose asset was removed draws nothing
        return <MediaLayer key={clip.id} clip={clip} asset={asset} src={assetUrl(baseUrl, asset, mode)} fps={fps} muted={track.muted || clip.muted} />;
      })}
    </>
  );
});

export const ProjectComposition: React.FC<EngineProps> = ({project, mode, baseUrl}) => {
  const assets = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);
  // tracks[0] is the top layer, so it is painted last.
  const ordered = useMemo(() => project.tracks.filter((t) => t.visible).reverse(), [project.tracks]);
  return (
    <AbsoluteFill style={{backgroundColor: project.backgroundColor}}>
      {ordered.map((track) => (
        <TrackLayers key={track.id} track={track} assets={assets} baseUrl={baseUrl} mode={mode} fps={project.fps} />
      ))}
    </AbsoluteFill>
  );
};
