import type {ExportHeight} from "@studio/schema";

/** H.264 video bitrate in bits per second by export size (the spike's 1080p export came to about 8 Mbit/s). */
export const EXPORT_BITRATE: Record<ExportHeight, number> = {1080: 10_000_000, 720: 5_000_000};
