// Shared by main, preload and renderer. Channel names, Zod schemas for every request (main validates all
// arguments, the renderer is never trusted) and the typed API exposed as window.studio.
import {EXPORT_HEIGHTS, FPS_OPTIONS, ProjectSchema, type ExportHeight, type ExportRecord, type Fps, type Project} from "@studio/schema";
import {z} from "zod";

export const IPC = {
  openMedia: "studio:open-media",
  metrics: "studio:metrics",
  flushRequest: "studio:flush-request", // main -> renderer: save now, the window is closing
  flushDone: "studio:flush-done",
  media: {
    import: "media:import",
    importPaths: "media:import-paths",
    relink: "media:relink",
    ensure: "media:ensure",
    cancel: "media:cancel",
    readPeaks: "media:read-peaks",
    deleteAssets: "media:delete-assets",
    event: "media:event", // main -> renderer
  },
  worker: {
    ready: "worker:ready",
    job: "worker:job", // main -> worker window
    cancel: "worker:cancel",
    meta: "worker:meta",
    progress: "worker:progress",
    writeAt: "worker:write-at",
    commit: "worker:commit",
    done: "worker:done",
  },
  exports: {
    start: "exports:start",
    cancel: "exports:cancel",
    list: "exports:list",
    event: "exports:event", // main -> renderer
  },
  render: {
    ready: "render:ready",
    job: "render:job", // main -> render window
    cancel: "render:cancel",
    progress: "render:progress",
    write: "render:write",
    done: "render:done",
  },
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

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ext = z.enum(["mp4", "mov", "m4v", "mp3", "m4a", "wav", "jpg", "jpeg", "png"]);
const assetType = z.enum(["video", "audio", "image"]);
const assetRef = z.object({sha256, ext, type: assetType, metaMissing: z.boolean()});
const cacheKind = z.enum(["proxy.mp4", "filmstrip.jpg", "thumb.jpg", "peaks"]);
const jobId = z.string().uuid();

/** What Mediabunny reads from a file. Sent by the worker window, so it is validated like any other input. */
export const MediaMetaSchema = z.object({
  durationUs: z.number().int().nonnegative().max(1e14).optional(),
  fps: z.number().positive().max(1000).optional(),
  width: z.number().int().positive().max(16384).optional(), // as displayed, after rotation
  height: z.number().int().positive().max(16384).optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  codec: z.string().max(40).optional(),
  audioChannels: z.number().int().nonnegative().max(64).optional(),
  hdr: z.boolean().optional(),
});
export type MediaMeta = z.infer<typeof MediaMetaSchema>;

export const STAGES = ["meta", "proxy", "thumbs", "peaks"] as const;
export type Stage = (typeof STAGES)[number];

// Media requests carry a project id; media paths are never accepted except dropped files (validated in main).
export const MediaReq = {
  import: z.object({projectId: id}),
  importPaths: z.object({projectId: id, paths: z.array(z.string().min(1).max(4096)).min(1).max(200)}),
  relink: z.object({projectId: id, sha256, type: assetType}),
  ensure: z.object({projectId: id, items: z.array(assetRef).max(2000)}),
  cancel: z.object({projectId: id, sha256: sha256.optional()}),
  peaks: z.object({projectId: id, sha256}),
  remove: z.object({projectId: id, items: z.array(z.object({sha256, ext})).max(2000)}),
} as const;

// Messages from the hidden worker window. Main hands out job ids, so these are only accepted for a running job.
const MAX_WRITE = 16 * 1024 * 1024;
export const WorkerReq = {
  meta: z.object({jobId, meta: MediaMetaSchema}),
  progress: z.object({jobId, stage: z.enum(STAGES), fraction: z.number().min(0).max(1)}),
  writeAt: z.object({jobId, kind: cacheKind, position: z.number().int().nonnegative().max(8 * 1024 ** 3), data: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_WRITE, "Write too large")}),
  commit: z.object({jobId, kind: cacheKind}),
  done: z.object({jobId, error: z.string().max(2000).optional()}),
} as const;

// Export. The renderer only says which project and which size; main picks the destination in a save dialog and reads the
// project from disk, so no path and no project snapshot comes from the renderer.
const exportHeight = z.union(EXPORT_HEIGHTS.map((h) => z.literal(h)) as [z.ZodLiteral<1080>, z.ZodLiteral<720>]);
export const ExportReq = {
  start: z.object({projectId: id, height: exportHeight}),
  cancel: z.object({exportId: id}),
  list: z.object({projectId: id}),
} as const;

// Messages from the hidden render window. Accepted only for the export that is running.
export const RenderReq = {
  progress: z.object({jobId, fraction: z.number().min(0).max(1)}),
  write: z.object({jobId, position: z.number().int().nonnegative().max(32 * 1024 ** 3), data: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_WRITE, "Write too large")}),
  done: z.object({jobId, error: z.string().max(2000).optional()}),
} as const;

export type RenderJob = {
  jobId: string;
  /** Read from the project folder by main (validated), not sent by the renderer. */
  project: Project;
  /** media:// URL of the project folder; the export plays the original files beneath it. */
  baseUrl: string;
  totalFrames: number;
  /** Output size; `scale` is applied to the project's own size. */
  width: number;
  height: number;
  scale: number;
};

export type ExportEvent =
  | {kind: "progress"; exportId: string; projectId: string; fraction: number; elapsedMs: number; etaMs: number | null}
  | {kind: "finished"; exportId: string; projectId: string; record: ExportRecord};

export type WorkerJob = {
  jobId: string;
  sha256: string;
  type: "video" | "audio" | "image";
  srcUrl: string;
  /** Which derived files are still missing; the worker produces only these. */
  needs: {proxy: boolean; thumb: boolean; filmstrip: boolean; peaks: boolean};
};

export type ImportResult = {
  sha256: string;
  ext: string;
  relativePath: string;
  type: "video" | "audio" | "image";
  name: string;
  sizeBytes: number;
  existed: boolean;
};
export type ImportOutcome = {imported: ImportResult[]; errors: {name: string; message: string}[]};

export type MediaEvent =
  | {kind: "meta"; projectId: string; sha256: string; meta: MediaMeta}
  | {kind: "progress"; projectId: string; sha256: string; stage: Stage; fraction: number}
  | {kind: "done"; projectId: string; sha256: string}
  | {kind: "error"; projectId: string; sha256: string; message: string}
  | {kind: "cancelled"; projectId: string; sha256: string};

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
  durationFrames?: number;
  kinds?: ("video" | "audio" | "image")[];
};
/** `baseUrl` is the media:// URL of the project folder; assets, proxies and thumbnails are served beneath it. */
export type OpenedProject = {project: Project; recovered: boolean; baseUrl: string};

export type ExportStart = {exportId: string; fileName: string};

export type MediaHandle = {name: string; url: string; sizeMB: number};
export type MemoryMetrics = {totalMB: number; swapMB: number; byProcess: Record<string, number>};

export type StudioApi = {
  /** True only for development runs started with STUDIO_E2E=1 (adds a test hook, see App.tsx). */
  isE2E: boolean;
  /** Main shows the native open dialog, allows that folder for media:// and returns a handle. Renderer never supplies a path. */
  openMedia: () => Promise<MediaHandle | null>;
  onMetrics: (listener: (m: MemoryMetrics) => void) => () => void;
  /** Main asks the renderer to save before the window closes; the renderer must call flushDone() afterwards. */
  onFlushRequest: (listener: () => void) => () => void;
  flushDone: () => Promise<void>;
  media: {
    /** Native multi-select dialog in main, then copy into the project. Resolves with nothing imported if cancelled. */
    import: (projectId: string) => Promise<ImportOutcome>;
    /** Files dropped from Finder. Main re-validates every path (type, regular file, not inside app data). */
    importPaths: (projectId: string, paths: string[]) => Promise<ImportOutcome>;
    /** Pick a replacement file for a missing asset (native dialog). Null if cancelled. */
    relink: (projectId: string, sha256: string, type: "video" | "audio" | "image") => Promise<ImportResult | null>;
    /** Queue any missing proxies, thumbnails and peaks. Returns the hashes whose source file is gone and those that already have a proxy. */
    ensure: (projectId: string, items: {sha256: string; ext: string; type: "video" | "audio" | "image"; metaMissing: boolean}[]) => Promise<{missing: string[]; proxies: string[]}>;
    cancel: (projectId: string, sha256?: string) => Promise<void>;
    readPeaks: (projectId: string, sha256: string) => Promise<Uint8Array | null>;
    deleteAssets: (projectId: string, items: {sha256: string; ext: string}[]) => Promise<void>;
    onEvent: (listener: (e: MediaEvent) => void) => () => void;
    /** Path of a dropped File (the renderer has no access to paths otherwise). */
    pathOf: (file: File) => string;
  };
  exports: {
    /** Save dialog in main (suggested name "<project> v<n>.mp4"), then the export runs; progress and the result arrive as events. Null if the dialog was cancelled. Save the project first. */
    start: (projectId: string, height: ExportHeight) => Promise<ExportStart | null>;
    cancel: (exportId: string) => Promise<void>;
    list: (projectId: string) => Promise<ExportRecord[]>;
    onEvent: (listener: (e: ExportEvent) => void) => () => void;
  };
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
