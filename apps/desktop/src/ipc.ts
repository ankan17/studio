// Shared by main, preload and renderer. Channel names, Zod schemas for every request (main validates all
// arguments, the renderer is never trusted) and the typed API exposed as window.studio.
import {FPS_OPTIONS, ProjectSchema, type Fps, type Project} from "@studio/schema";
import {z} from "zod";

export const IPC = {
  openMedia: "studio:open-media",
  metrics: "studio:metrics",
  flushRequest: "studio:flush-request", // main -> renderer: save now, the window is closing
  flushDone: "studio:flush-done",
  projects: {
    list: "projects:list",
    create: "projects:create",
    open: "projects:open",
    save: "projects:save",
    rename: "projects:rename",
    duplicate: "projects:duplicate",
    remove: "projects:remove",
    setThumbnail: "projects:set-thumbnail",
  },
} as const;

const id = z.string().uuid();
const fps = z.union(FPS_OPTIONS.map((f) => z.literal(f)) as [z.ZodLiteral<24>, z.ZodLiteral<25>, z.ZodLiteral<30>, z.ZodLiteral<60>]);
const name = z.string().trim().min(1).max(120);

export const Req = {
  create: z.object({name, format: z.object({width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), fps})}),
  id: z.object({id}),
  save: z.object({project: ProjectSchema}),
  rename: z.object({id, name}),
  duplicate: z.object({id, fps: fps.optional()}),
  setThumbnail: z.object({
    id,
    jpeg: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength > 3 && b.byteLength <= 2 * 1024 * 1024, "Thumbnail must be 2MB or smaller")
      .refine((b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, "Thumbnail must be a JPEG"),
  }),
} as const;

export type CreateRequest = z.infer<typeof Req.create>;

export type ProjectCard = {
  id: string;
  name: string;
  updatedAt: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  thumbnailUrl: string | null;
};
export type OpenedProject = {project: Project; recovered: boolean};

export type MediaHandle = {name: string; url: string; sizeMB: number};
export type MemoryMetrics = {totalMB: number; swapMB: number; byProcess: Record<string, number>};

export type StudioApi = {
  /** Main shows the native open dialog, allows that folder for media:// and returns a handle. Renderer never supplies a path. */
  openMedia: () => Promise<MediaHandle | null>;
  onMetrics: (listener: (m: MemoryMetrics) => void) => () => void;
  /** Main asks the renderer to save before the window closes; the renderer must call flushDone() afterwards. */
  onFlushRequest: (listener: () => void) => () => void;
  flushDone: () => Promise<void>;
  projects: {
    list: () => Promise<ProjectCard[]>;
    create: (req: CreateRequest) => Promise<Project>;
    open: (id: string) => Promise<OpenedProject>;
    save: (project: Project) => Promise<void>;
    rename: (id: string, name: string) => Promise<Project>;
    duplicate: (id: string, fps?: Fps) => Promise<Project>;
    /** Asks for confirmation in a native dialog, then moves the project to the Trash. Returns false if cancelled. */
    remove: (id: string) => Promise<boolean>;
    setThumbnail: (id: string, jpeg: Uint8Array) => Promise<void>;
  };
};

declare global {
  interface Window {
    studio: StudioApi;
  }
}
