import {describe, expect, it} from "vitest";
import {appendAssetClip, canAppend, clipsAtFrame, createProject, pictureLayout, projectDurationFrames, timecode, type Asset} from "./index";

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

describe("pictureLayout", () => {
  const W = 1080, H = 1920; // a portrait frame
  const src = {width: 1920, height: 1080};
  const near = (a: Record<string, number>, b: Record<string, number>) => Object.keys(b).forEach((k) => expect(a[k]).toBeCloseTo(b[k]!, 3));
  it("contain without a crop fits the whole picture", () => {
    const l = pictureLayout({fit: "contain"}, src, W, H);
    near(l, {boxW: 1080, boxH: 607.5, mediaW: 1080, mediaH: 607.5, mediaX: 0, mediaY: 0});
  });
  it("contain with a crop fits the kept part and offsets the media under it", () => {
    // keep the right half: 960x1080 of source, fitted into 1080x1920 at 1.125x
    const l = pictureLayout({fit: "contain", crop: {x: 0.5, y: 0, width: 0.5, height: 1}}, src, W, H);
    near(l, {boxW: 1080, boxH: 1215, mediaW: 2160, mediaH: 1215, mediaX: -1080, mediaY: 0});
  });
  it("cover fills the frame and centres the kept part", () => {
    const s = 1920 / 1080;
    const l = pictureLayout({fit: "cover"}, src, W, H);
    near(l, {boxW: 1080, boxH: 1920, mediaW: 1920 * s, mediaH: 1920, mediaX: (1080 - 1920 * s) / 2, mediaY: 0});
  });
  it("unknown source size: the box is the frame and the media fills it", () => {
    near(pictureLayout({fit: "contain", crop: {x: 0.1, y: 0.1, width: 0.5, height: 0.5}}, {}, W, H), {boxW: W, boxH: H, mediaW: W, mediaH: H, mediaX: 0, mediaY: 0});
  });
});
