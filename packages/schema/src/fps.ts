import type {Project} from "./index";

// Changing fps (on duplicate) converts frame positions through time, not by copying numbers.
// A frame count f at oldFps lasts f / oldFps seconds; at newFps that is round(f / oldFps * newFps) frames.
export function convertProjectFps(project: Project, fps: Project["fps"]): Project {
  if (fps === project.fps) return project;
  const conv = (f: number) => Math.round((f / project.fps) * fps);
  return {
    ...project,
    fps,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({
        ...c,
        startFrame: conv(c.startFrame),
        durationInFrames: conv(c.durationInFrames),
        fadeInFrames: conv(c.fadeInFrames),
        fadeOutFrames: conv(c.fadeOutFrames),
        transitionOut: c.transitionOut && {...c.transitionOut, durationInFrames: conv(c.transitionOut.durationInFrames)},
      })),
    })),
    markers: project.markers.map((m) => ({...m, frame: conv(m.frame)})),
  };
}
