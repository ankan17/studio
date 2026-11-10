// Shared between main, preload and renderer. One place for channel names and the typed API.
export const IPC = {
  openMedia: "studio:open-media",
  metrics: "studio:metrics",
} as const;

export type MediaHandle = {name: string; url: string; sizeMB: number};

export type MemoryMetrics = {totalMB: number; swapMB: number; byProcess: Record<string, number>};

export type StudioApi = {
  /** Main shows the native open dialog, allows that folder for media:// and returns a handle. Renderer never supplies a path. */
  openMedia: () => Promise<MediaHandle | null>;
  onMetrics: (listener: (m: MemoryMetrics) => void) => () => void;
};

declare global {
  interface Window {
    studio: StudioApi;
  }
}
