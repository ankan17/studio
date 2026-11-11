// Filmstrip sprites and waveform peaks for the clips the timeline is drawing. Only what the visible clips need is
// loaded, and filmstrips that scroll out of view are dropped (project plan, Memory lever: "loaded per visible timeline
// viewport and evicted on scroll"). A decoded 60-tile strip is about 3.5MB, so at most a few stay around.
const KEEP_HIDDEN = 4;

type Strip = {img: HTMLImageElement; ready: boolean; lastUsed: number};
const strips = new Map<string, Strip>();
const peaks = new Map<string, Uint8Array | null | "loading">();
let clock = 0;
let lastUsed = 0;

/** A loaded sprite for the url, or null while it loads (onReady fires once it has). */
export function image(url: string, onReady: () => void): HTMLImageElement | null {
  let s = strips.get(url);
  if (!s) {
    const img = new Image();
    img.crossOrigin = "anonymous"; // media:// is a CORS-enabled scheme; this keeps the canvas readable (tests sample its pixels)
    s = {img, ready: false, lastUsed: 0};
    const entry = s;
    img.onload = () => {
      entry.ready = true;
      onReady();
    };
    img.onerror = () => void strips.delete(url); // not written yet or unreadable: the next paint asks again
    img.src = url;
    strips.set(url, s);
  }
  s.lastUsed = ++clock;
  return s.ready ? s.img : null;
}

/** Drop images not drawn in this pass, keeping the few most recently used so scrolling back is instant. */
export function evictImages(used: Set<string>): void {
  lastUsed = used.size;
  const hidden = [...strips].filter(([url]) => !used.has(url)).sort((a, b) => b[1].lastUsed - a[1].lastUsed);
  for (const [url, s] of hidden.slice(KEEP_HIDDEN)) {
    s.img.src = "";
    strips.delete(url);
  }
}

/** Peaks (one byte per 10ms) for an asset, or null while loading or when it has no sound. */
export function peaksFor(projectId: string, key: string, sha256: string, onReady: () => void): Uint8Array | null {
  const p = peaks.get(key);
  if (p === undefined) {
    peaks.set(key, "loading");
    window.studio.media.readPeaks(projectId, sha256).then(
      (data) => {
        peaks.set(key, data);
        if (data) onReady();
      },
      () => peaks.delete(key), // try again on the next paint
    );
    return null;
  }
  return p === "loading" ? null : p;
}

export function clearTimelineMedia(): void {
  for (const s of strips.values()) s.img.src = "";
  strips.clear();
  peaks.clear();
}

/** For the end-to-end test: images held, and how many the last paint drew. */
export const timelineMediaStats = () => ({images: strips.size, drawn: lastUsed, peaks: peaks.size});
