// Project schema v1. Rules fixed before M1 (project plan, "Project model"):
// - timeline units are integer project frames; source units are integer microseconds
// - speed: sourceDurationUs = durationInFrames / fps * speed * 1e6
// - a transition belongs to the gap between two adjacent clips on one track (property of the earlier clip)
// - assets live in a manifest inside project.json; the JSON index only mirrors it
// - fonts are referenced by family name; the app resolves them to bundled files
import {z} from "zod";

export * from "./formats";
export * from "./migrate";
export * from "./fps";

export const SCHEMA_VERSION = 1;
export const FPS_OPTIONS = [24, 25, 30, 60] as const;

const int = z.number().int();
const frames = int.nonnegative();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const AssetSchema = z.object({
  id: z.string(),
  relativePath: z.string(),
  type: z.enum(["video", "audio", "image"]),
  durationUs: int.nonnegative().optional(),
  fps: z.number().positive().optional(),
  width: int.positive().optional(),
  height: int.positive().optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  sha256: z.string(),
  proxyPath: z.string().optional(),
  // Added in M2 (all optional, so v1 projects still load): what the user sees and what the media panel filters on.
  name: z.string().optional(), // original file name
  sizeBytes: int.nonnegative().optional(),
  codec: z.string().optional(),
  audioChannels: int.nonnegative().optional(),
  hdr: z.boolean().optional(),
});

export const TransitionSchema = z.object({
  // Only non-shader presets: dissolve() needs Chrome 149+, Electron 42 ships 148.
  kind: z.enum(["fade", "slide", "wipe"]),
  durationInFrames: frames,
});

export const TransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  scale: z.number().positive().default(1),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  flipH: z.boolean().default(false),
});

export const CropSchema = z.object({x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive()});

export const TextSchema = z.object({
  content: z.string(),
  fontFamily: z.string().default("Noto Sans Bengali"),
  fontSize: z.number().positive().default(64),
  color: hex.default("#ffffff"),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  background: z.string().optional(),
  stroke: z.object({color: hex, width: z.number().nonnegative()}).optional(),
  shadow: z.object({color: z.string(), blur: z.number().nonnegative(), x: z.number(), y: z.number()}).optional(),
  maxWidth: z.number().positive().optional(),
  lineHeight: z.number().positive().default(1.2),
  enterPreset: z.string().optional(),
  exitPreset: z.string().optional(),
});

export const ClipSchema = z.object({
  id: z.string(),
  assetId: z.string().optional(), // text clips have no asset; an audio clip may reference a video asset
  startFrame: frames,
  durationInFrames: frames,
  sourceStartUs: int.nonnegative().default(0),
  sourceDurationUs: int.nonnegative().default(0),
  speed: z.number().positive().default(1),
  transform: TransformSchema.default(() => TransformSchema.parse({})),
  crop: CropSchema.optional(),
  fit: z.enum(["cover", "contain"]).default("contain"),
  volume: z.number().min(0).default(1),
  muted: z.boolean().default(false),
  fadeInFrames: frames.default(0),
  fadeOutFrames: frames.default(0),
  text: TextSchema.optional(),
  // Transition into the next clip on the same track; consumes handle frames from both clips.
  transitionOut: TransitionSchema.optional(),
});

export const TrackSchema = z.object({
  id: z.string(),
  type: z.enum(["video", "audio", "text", "image", "caption"]), // caption is reserved
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  clips: z.array(ClipSchema).default([]),
}); // track order is the array order

export const MarkerSchema = z.object({id: z.string(), frame: frames, label: z.string()});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  width: int.min(16).max(8192),
  height: int.min(16).max(8192),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  backgroundColor: hex.default("#000000"),
  assets: z.array(AssetSchema).default([]),
  tracks: z.array(TrackSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
});

export type Asset = z.infer<typeof AssetSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Fps = Project["fps"];

export const createProject = (id: string, name: string, format: {width: number; height: number; fps: Fps}): Project =>
  ProjectSchema.parse({schemaVersion: SCHEMA_VERSION, id, name, ...format});
export * from "./timeline";
