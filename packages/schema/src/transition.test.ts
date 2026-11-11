import {describe, expect, it} from "vitest";
import type {Clip, Track} from "./index";
import {transitionLook, transitionSpans} from "./transition";

const clip = (id: string, start: number, dur: number, out?: Clip["transitionOut"]): Clip => ({
  id, assetId: "v", startFrame: start, durationInFrames: dur, sourceStartUs: 0, sourceDurationUs: 0, speed: 1,
  transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false}, fit: "contain", volume: 1, muted: false, fadeInFrames: 0, fadeOutFrames: 0,
  ...(out ? {transitionOut: out} : {}),
});
const track = (clips: Clip[]): Track => ({id: "V1", type: "video", muted: false, locked: false, visible: true, clips});

describe("transition spans", () => {
  it("centres a transition on the cut: the outgoing clip runs ceil(d/2) past it, the incoming starts floor(d/2) early", () => {
    const s = transitionSpans(track([clip("a", 0, 60, {kind: "fade", durationInFrames: 15}), clip("b", 60, 60), clip("c", 120, 60)]));
    expect(s.get("a")).toEqual({lead: 0, tail: 8, in: null, out: {kind: "fade", frames: 15}});
    expect(s.get("b")).toEqual({lead: 7, tail: 0, in: {kind: "fade", frames: 15}, out: null});
    expect(s.get("c")).toEqual({lead: 0, tail: 0, in: null, out: null});
  });
  it("ignores a transition with no clip right after it", () => {
    const s = transitionSpans(track([clip("a", 0, 60, {kind: "fade", durationInFrames: 10}), clip("b", 70, 60)]));
    expect(s.get("a")).toEqual({lead: 0, tail: 0, in: null, out: null});
  });
});

describe("transition looks", () => {
  it("fade: the incoming clip dissolves in over the outgoing one", () => {
    expect(transitionLook("fade", 0, "in").opacity).toBe(0);
    expect(transitionLook("fade", 1, "in").opacity).toBe(1);
    expect(transitionLook("fade", 0.5, "out")).toEqual({});
  });
  it("slide pushes both clips left; wipe reveals the incoming clip from the left", () => {
    expect(transitionLook("slide", 0, "in").transform).toBe("translateX(100%)");
    expect(transitionLook("slide", 1, "out").transform).toBe("translateX(-100%)");
    expect(transitionLook("wipe", 0, "in").clipPath).toBe("inset(0 100% 0 0)");
    expect(transitionLook("wipe", 1, "in").clipPath).toBe("inset(0 0% 0 0)");
  });
});
