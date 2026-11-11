import {describe, expect, it} from "vitest";
import {appendAssetClip, canAppend, clipsAtFrame, createProject, projectDurationFrames, timecode, type Asset} from "./index";

const asset = (over: Partial<Asset> = {}): Asset => ({id: "a1", relativePath: "assets/x.mp4", type: "video", sha256: "0".repeat(64), rotation: 0, durationUs: 2_000_000, ...over});
const project = () => createProject("11111111-1111-4111-8111-111111111111", "T", {width: 1920, height: 1080, fps: 30});

describe("timeline helpers", () => {
  it("appends clips back to back on one video track, durations in frames", () => {
    const p = project();
    appendAssetClip(p, asset(), {clip: "c1", track: "t1"});
    appendAssetClip(p, asset({id: "a2", durationUs: 1_500_000}), {clip: "c2", track: "t-unused"});
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0]!.clips.map((c) => [c.startFrame, c.durationInFrames])).toEqual([[0, 60], [60, 45]]);
    expect(projectDurationFrames(p)).toBe(105);
  });
  it("puts audio on its own track below video and images on the video track", () => {
    const p = project();
    appendAssetClip(p, asset({id: "m", type: "audio"}), {clip: "c1", track: "ta"});
    appendAssetClip(p, asset({id: "v"}), {clip: "c2", track: "tv"});
    appendAssetClip(p, asset({id: "i", type: "image", durationUs: undefined}), {clip: "c3", track: "x"});
    expect(p.tracks.map((t) => t.type)).toEqual(["video", "audio"]);
    expect(p.tracks[0]!.clips[1]).toMatchObject({startFrame: 60, durationInFrames: 150}); // 5s still at 30fps
  });
  it("refuses an asset whose duration is not known yet", () => {
    const p = project();
    expect(canAppend(asset({durationUs: undefined}))).toBe(false);
    expect(appendAssetClip(p, asset({durationUs: undefined}), {clip: "c", track: "t"})).toBeNull();
    expect(p.tracks).toHaveLength(0);
  });
  it("finds the clips under a frame, top track first", () => {
    const p = project();
    appendAssetClip(p, asset(), {clip: "c1", track: "t1"});
    expect(clipsAtFrame(p, 59).map((x) => x.clip.id)).toEqual(["c1"]);
    expect(clipsAtFrame(p, 60)).toEqual([]);
  });
  it("formats timecode", () => {
    expect(timecode(0, 30)).toBe("00:00:00");
    expect(timecode(95, 30)).toBe("00:03:05");
    expect(timecode(30 * 3725 + 7, 30)).toBe("1:02:05:07");
  });
  it("the new clip validates against the project schema", async () => {
    const {ProjectSchema} = await import("./index");
    const p = project();
    appendAssetClip(p, asset(), {clip: "c1", track: "t1"});
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
});
