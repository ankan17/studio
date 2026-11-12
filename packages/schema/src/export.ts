// Export settings and history records. Pure, so the dialog, main and the tests share one definition.
import {z} from "zod";

/** Export sizes: the short side of the picture in pixels. */
export const EXPORT_HEIGHTS = [1080, 720] as const;
export type ExportHeight = (typeof EXPORT_HEIGHTS)[number];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for a project: the short side becomes `short`, the other side keeps the aspect ratio, both even (H.264 needs it). */
export function exportSize(width: number, height: number, short: number): {width: number; height: number; scale: number} {
  const scale = short / Math.min(width, height);
  return {width: even(width * scale), height: even(height * scale), scale};
}

/** The default file name for the next export: the project name without characters a file name cannot hold, then " v<n>.mp4". */
export function exportFileName(projectName: string, version: number): string {
  // eslint-disable-next-line no-control-regex
  const base = projectName.replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 80).trim();
  return `${base || "Untitled"} v${version}.mp4`;
}

export const ExportRecordSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1),
  fileName: z.string().min(1).max(255),
  /** Where the file was written (chosen in the save dialog). The file may have been moved or deleted since. */
  path: z.string().min(1).max(4096),
  height: z.union([z.literal(1080), z.literal(720)]),
  width: z.number().int().positive(),
  outputHeight: z.number().int().positive(),
  fps: z.number().positive(),
  durationFrames: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  startedAt: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  status: z.enum(["done", "failed", "cancelled"]),
  error: z.string().max(2000).optional(),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

/** The version number for the next export: one more than the highest used, so deleting history never reuses a number. */
export const nextExportVersion = (records: Pick<ExportRecord, "version">[]): number => records.reduce((m, r) => Math.max(m, r.version), 0) + 1;
