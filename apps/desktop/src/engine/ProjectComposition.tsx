// The one composition both preview and export draw (the plan's "same composition and same media tags in both").
// Built from the project JSON. Each clip is its own memoised layer, so editing one clip re-renders only that clip,
// and a Sequence with `premountFor` (absolute-fill layout only) mounts it two seconds early and unmounts it after it ends: only clips near the
// playhead exist in the DOM.
import {graphemes, pictureLayout, textAnimation, transitionLook, transitionSpans, type Asset, type Clip, type Project, type Span, type Track, type TransitionKind} from "@studio/schema";
import {Audio, Video} from "@remotion/media";
import {memo, useMemo} from "react";
import {lutLook} from "./lut-effect";
import {AbsoluteFill, Img, Sequence, useCurrentFrame} from "remotion";

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

/**
 * How a clip runs into its neighbours (transitionSpans): it plays `lead` frames before its start and `tail` after its
 * end. Passed as plain values so a clip's memoised layer only re-renders when its own spans change.
 */
type SpanProps = {lead: number; tail: number; inKind: TransitionKind | null; inFrames: number; outKind: TransitionKind | null; outFrames: number};
const NO_SPAN: SpanProps = {lead: 0, tail: 0, inKind: null, inFrames: 0, outKind: null, outFrames: 0};

/** Where the outgoing half of a transition starts, in frames from the start of the clip's Sequence. */
const outStart = (clip: Clip, s: SpanProps) => s.lead + clip.durationInFrames - Math.floor(s.outFrames / 2);

/**
 * Volume over the clip (frames from the start of its Sequence): linear fade in and out at the clip's own edges, and
 * across a transition the sound crossfades with its neighbour's.
 */
function volumeFn(clip: Clip, muted: boolean, s: SpanProps) {
  if (muted) return 0;
  const {fadeInFrames: fi, fadeOutFrames: fo, durationInFrames: d, volume} = clip;
  if (!fi && !fo && !s.inFrames && !s.outFrames) return volume;
  return (f: number) => {
    const c = f - s.lead;
    let v = volume * Math.min(1, fi ? Math.max(0, c) / fi : 1, fo ? Math.max(0, d - c) / fo : 1);
    if (s.inFrames) v *= Math.min(1, f / s.inFrames);
    if (s.outFrames && f >= outStart(clip, s)) v *= Math.max(0, 1 - (f - outStart(clip, s)) / s.outFrames);
    return v;
  };
}

/** The transition look (fade, slide, wipe) while the clip is inside one; the clip as it is otherwise. */
function TransitionFx({clip, span, children}: {clip: Clip; span: SpanProps; children: React.ReactNode}) {
  const f = useCurrentFrame();
  let look = {};
  if (span.inKind && f < span.inFrames) look = transitionLook(span.inKind, (f + 0.5) / span.inFrames, "in");
  else if (span.outKind && f >= outStart(clip, span)) look = transitionLook(span.outKind, (f - outStart(clip, span) + 0.5) / span.outFrames, "out");
  return <AbsoluteFill style={look}>{children}</AbsoluteFill>;
}

type LayerProps = {clip: Clip; asset: Asset; src: string; fps: number; muted: boolean; width: number; height: number; soundOnly: boolean} & SpanProps;

// Spike S1 only: one look on every video layer. window.studioSpikeLook = null turns it off for a baseline.
const spikeLook = (): {lutId: string; intensity: number} | null => {
  const w = globalThis as {studioSpikeLook?: {lutId: string; intensity: number} | null};
  return w.studioSpikeLook === undefined ? {lutId: "teal-orange", intensity: 0.7} : w.studioSpikeLook;
};

const MediaLayer = memo(function MediaLayer({clip, asset, src, fps, muted, width, height, soundOnly, ...span}: LayerProps) {
  const premountFor = Math.round(PREMOUNT_SECONDS * fps);
  // a transition into this clip starts it early, on source before its in point
  const trimBefore = usFrames(Math.max(0, clip.sourceStartUs - (span.lead / fps) * clip.speed * 1e6), fps);
  const from = clip.startFrame - span.lead;
  const length = clip.durationInFrames + span.lead + span.tail;
  const fill = {width: "100%", height: "100%"} as const; // explicit size: without it a portrait clip is cropped
  if (asset.type === "audio" || soundOnly) {
    return (
      <Sequence from={from} durationInFrames={length} premountFor={premountFor}>
        <Audio src={src} trimBefore={trimBefore} playbackRate={clip.speed} volume={volumeFn(clip, muted, span)} />
      </Sequence>
    );
  }
  // A crop shows part of the media: a box the size of the kept part, with the whole media placed under it.
  const crop = clip.crop && asset.width && asset.height ? pictureLayout(clip, asset, width, height) : null;
  const fit = crop ? "fill" : clip.fit;
  const look = spikeLook();
  const size = crop ? ({position: "absolute", left: crop.mediaX, top: crop.mediaY, width: crop.mediaW, height: crop.mediaH} as const) : fill;
  const media =
    asset.type === "video" ? (
      <Video src={src} trimBefore={trimBefore} playbackRate={clip.speed} volume={volumeFn(clip, muted, span)} objectFit={fit} style={size} effects={look ? [lutLook(look)] : []} />
    ) : (
      <Img src={src} style={{...size, objectFit: fit}} />
    );
  const picture = (
    <AbsoluteFill style={{transform: transformCss(clip.transform), opacity: clip.transform.opacity}}>
      {crop ? (
        <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
          <div style={{position: "relative", flexShrink: 0, overflow: "hidden", width: crop.boxW, height: crop.boxH}}>{media}</div>
        </AbsoluteFill>
      ) : (
        media
      )}
    </AbsoluteFill>
  );
  return (
    <Sequence from={from} durationInFrames={length} premountFor={premountFor}>
      {span.inKind || span.outKind ? <TransitionFx clip={clip} span={span}>{picture}</TransitionFx> : picture}
    </Sequence>
  );
});

/**
 * A title: its text styled from the clip, placed by the clip's transform, animated by its enter and exit presets. The
 * box is centred in the frame; the typewriter keeps the untyped rest of the text in the layout (hidden), so the
 * lines do not move as letters appear. Every style used here (stroke, shadow, background) is drawn by the web renderer.
 */
function TitleText({clip, fps, width}: {clip: Clip; fps: number; width: number}) {
  const frame = useCurrentFrame();
  const t = clip.text!;
  const a = textAnimation(t, frame, clip.durationInFrames, fps);
  const fs = t.fontSize;
  const shown = a.chars === null ? t.content : graphemes(t.content).slice(0, a.chars).join("");
  const rest = a.chars === null ? "" : t.content.slice(shown.length);
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center", transform: transformCss(clip.transform), opacity: clip.transform.opacity * a.opacity}}>
      <div
        data-text-clip={clip.id}
        style={{
          fontFamily: t.fontFamily === "Noto Sans Bengali" ? `"${t.fontFamily}"` : `"${t.fontFamily}", "Noto Sans Bengali"`, // Bengali in a Latin-only font falls back to Noto
          fontSize: fs,
          lineHeight: t.lineHeight,
          color: t.color,
          textAlign: t.alignment,
          maxWidth: t.maxWidth ?? width * 0.9,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          background: t.background,
          padding: t.background ? `${0.18 * fs}px ${0.42 * fs}px` : 0,
          borderRadius: t.background ? 0.16 * fs : 0,
          WebkitTextStroke: t.stroke && t.stroke.width > 0 ? `${t.stroke.width}px ${t.stroke.color}` : undefined,
          paintOrder: "stroke fill", // the outline sits behind the letters instead of eating into them
          textShadow: t.shadow ? `${t.shadow.x}px ${t.shadow.y}px ${t.shadow.blur}px ${t.shadow.color}` : undefined,
          transform: a.dy || a.scale !== 1 ? `translateY(${a.dy * fs}px) scale(${a.scale})` : undefined,
        }}
      >
        {shown}
        {rest && <span style={{visibility: "hidden"}}>{rest}</span>}
      </div>
    </AbsoluteFill>
  );
}

const TextLayer = memo(function TextLayer({clip, fps, width}: {clip: Clip; fps: number; width: number}) {
  return (
    <Sequence from={clip.startFrame} durationInFrames={clip.durationInFrames} premountFor={Math.round(PREMOUNT_SECONDS * fps)}>
      <TitleText clip={clip} fps={fps} width={width} />
    </Sequence>
  );
});

function spanProps(s: Span | undefined): SpanProps {
  if (!s || (!s.in && !s.out)) return NO_SPAN;
  return {lead: s.lead, tail: s.tail, inKind: s.in?.kind ?? null, inFrames: s.in?.frames ?? 0, outKind: s.out?.kind ?? null, outFrames: s.out?.frames ?? 0};
}

type TrackProps = {track: Track; assets: Map<string, Asset>; baseUrl: string; mode: EngineProps["mode"]; fps: number; width: number; height: number};

const TrackLayers = memo(function TrackLayers({track, assets, baseUrl, mode, fps, width, height}: TrackProps) {
  const spans = useMemo(() => transitionSpans(track), [track]);
  return (
    <>
      {track.clips.map((clip) => {
        if (clip.text) return <TextLayer key={clip.id} clip={clip} fps={fps} width={width} />;
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
        if (!asset) return null; // a clip whose asset was removed draws nothing
        return <MediaLayer key={clip.id} clip={clip} asset={asset} src={assetUrl(baseUrl, asset, mode)} fps={fps} muted={track.muted || clip.muted} width={width} height={height} soundOnly={track.type === "audio"} {...spanProps(spans.get(clip.id))} />;
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
        <TrackLayers key={track.id} track={track} assets={assets} baseUrl={baseUrl} mode={mode} fps={project.fps} width={project.width} height={project.height} />
      ))}
    </AbsoluteFill>
  );
};
