// Snapping for timeline drags and trims: clip edges on every track, the playhead, markers and frame 0.
import type {Project} from "@studio/schema";

/** Frames a drag may snap to, excluding the edges of the clips being dragged. Sorted, unique. */
export function snapPoints(p: Pick<Project, "tracks" | "markers">, opts: {exclude?: Set<string>; playhead?: number}): number[] {
  const set = new Set<number>([0]);
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (opts.exclude?.has(c.id)) continue;
      set.add(c.startFrame);
      set.add(c.startFrame + c.durationInFrames);
    }
  for (const m of p.markers) set.add(m.frame);
  if (opts.playhead !== undefined) set.add(opts.playhead);
  return [...set].sort((a, b) => a - b);
}

/**
 * Snap a set of moving edges (frames) by one shared delta: the smallest adjustment that puts any edge on a snap point,
 * if it is within `threshold` frames. Returns the adjustment (0 when nothing is close) and the point snapped to.
 */
export function snap(edges: number[], points: number[], threshold: number): {adjust: number; at: number | null} {
  let best = {adjust: 0, at: null as number | null, dist: threshold + 1};
  for (const e of edges)
    for (const pt of nearby(points, e, threshold)) {
      const dist = Math.abs(pt - e);
      if (dist < best.dist) best = {adjust: pt - e, at: pt, dist};
    }
  return {adjust: best.adjust, at: best.at};
}

/** Points within threshold of a value, by binary search over the sorted list. */
function nearby(points: number[], v: number, threshold: number): number[] {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]! < v - threshold) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < points.length && points[i]! <= v + threshold; i++) out.push(points[i]!);
  return out;
}
