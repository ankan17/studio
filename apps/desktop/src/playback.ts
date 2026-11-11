// Playback state for the open project. The Remotion Player owns the clock; this store mirrors it (frame, playing) for the
// UI and gives every control one place to drive it from. Keyboard shortcuts and buttons call the same functions.
import type {PlayerRef} from "@remotion/player";
import {create} from "zustand";

type PlaybackState = {frame: number; playing: boolean; loop: boolean; duration: number};
export const usePlayback = create<PlaybackState>(() => ({frame: 0, playing: false, loop: false, duration: 0}));

let player: PlayerRef | null = null;
let detach: (() => void) | null = null;

export function attachPlayer(p: PlayerRef | null): void {
  detach?.();
  detach = null;
  player = p;
  if (!p) return;
  const onFrame = (e: {detail: {frame: number}}) => usePlayback.setState({frame: e.detail.frame});
  const onPlay = () => usePlayback.setState({playing: true});
  const onPause = () => usePlayback.setState({playing: false});
  // Rest on the last frame when playback reaches the end (the Player would otherwise show frame 0).
  // Only when playback was running: seeking onto the last frame also fires "ended", and must not seek again.
  const onEnded = () => {
    const wasPlaying = usePlayback.getState().playing;
    usePlayback.setState({playing: false});
    if (wasPlaying && !usePlayback.getState().loop) playback.toEnd();
  };
  p.addEventListener("frameupdate", onFrame);
  p.addEventListener("play", onPlay);
  p.addEventListener("pause", onPause);
  p.addEventListener("ended", onEnded);
  detach = () => {
    p.removeEventListener("frameupdate", onFrame);
    p.removeEventListener("play", onPlay);
    p.removeEventListener("pause", onPause);
    p.removeEventListener("ended", onEnded);
  };
  usePlayback.setState({frame: p.getCurrentFrame(), playing: p.isPlaying()});
}

export const setDuration = (duration: number) => usePlayback.setState({duration});

const lastFrame = () => Math.max(0, usePlayback.getState().duration - 1);
const clamp = (f: number) => Math.min(lastFrame(), Math.max(0, Math.round(f)));

export const playback = {
  toggle() {
    if (!player || usePlayback.getState().duration === 0) return;
    if (player.isPlaying()) player.pause();
    else {
      if (player.getCurrentFrame() >= lastFrame()) player.seekTo(0); // play from the start after reaching the end
      player.play();
    }
  },
  pause: () => player?.pause(),
  play: () => player?.play(),
  seek(frame: number) {
    const f = clamp(frame);
    player?.seekTo(f);
    usePlayback.setState({frame: f});
  },
  step(delta: number) {
    player?.pause();
    playback.seek((player?.getCurrentFrame() ?? 0) + delta);
  },
  toStart: () => playback.seek(0),
  toEnd: () => playback.seek(lastFrame()),
  toggleLoop: () => usePlayback.setState((s) => ({loop: !s.loop})),
  reset() {
    usePlayback.setState({frame: 0, playing: false});
  },
};
