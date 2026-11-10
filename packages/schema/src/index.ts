// Project schema. Rules fixed before M1 (see the project plan, "Project model"):
// - timeline units are integer project frames; source units are integer microseconds
// - a transition belongs to the gap between two adjacent clips on one track
// - assets live in a manifest inside project.json; the JSON index only mirrors it
import {z} from "zod";

export const SCHEMA_VERSION = 1;

const int = z.number().int();
const frames = int.nonnegative();

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
});

export const TransitionSchema = z.object({
  // Only non-shader presets: dissolve() needs Chrome 149+, Electron 42 ships 148.
  kind: z.enum(["fade", "slide", "wipe"]),
  durationInFrames: frames,
});

export const ClipSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  startFrame: frames,
  durationInFrames: frames,
  sourceStartUs: int.nonnegative(),
  sourceDurationUs: int.nonnegative(),
  speed: z.number().positive().default(1),
  // Transition into the next clip on the same track; consumes handle frames from both clips.
  transitionOut: TransitionSchema.optional(),
});

export const TrackSchema = z.object({
  id: z.string(),
  type: z.enum(["video", "audio", "text", "image", "caption"]),
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(ClipSchema),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  fps: z.number().positive().default(30),
  width: int.positive().default(1920),
  height: int.positive().default(1080),
  assets: z.array(AssetSchema),
  tracks: z.array(TrackSchema),
});

export type Asset = z.infer<typeof AssetSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export const emptyProject = (id: string, name: string): Project =>
  ProjectSchema.parse({schemaVersion: SCHEMA_VERSION, id, name, assets: [], tracks: []});
