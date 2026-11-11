import {createProject, type Asset, type Clip, type Project} from "@studio/schema";
import {describe, expect, it} from "vitest";
import {applyCommand, clampTrim, History, locate, resolveMove, snap, snapPoints, type Command} from "./index";

const FPS = 30;
const asset = (id: string, over: Partial<Asset> = {}): Asset => ({id, relativePath: `assets/${id}.mp4`, type: "video", sha256: id.padEnd(64, "0"), rotation: 0, durationUs: 10_000_000, ...over});

/** A project with one video track (three 2s clips back to back, from 0s, 2s and 4s into a 10s source) and one audio track. */
function fixture(): Project {
  let p = createProject("11111111-1111-4111-8111-111111111111", "T", {width: 1920, height: 1080, fps: FPS});
  p = {...p, assets: [asset("v"), asset("m", {type: "audio"}), asset("still", {type: "image", durationUs: undefined})]};
  const clip = (id: string, start: number, srcS: number, assetId = "v"): Clip => ({
    id, assetId, startFrame: start, durationInFrames: 60, sourceStartUs: srcS * 1e6, sourceDurationUs: 2e6, speed: 1,
    transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false}, fit: "contain", volume: 1, muted: false, fadeInFrames: 0, fadeOutFrames: 0,
  });
  p.tracks = [
    {id: "V1", type: "video", muted: false, locked: false, visible: true, clips: [clip("a", 0, 2), clip("b", 60, 4), clip("c", 120, 6)]},
    {id: "A1", type: "audio", muted: false, locked: false, visible: true, clips: [clip("m1", 0, 0, "m")]},
  ];
  return p;
}

function ok(p: Project, cmd: Command): Project {
  const r = applyCommand(p, cmd);
  if (!r.ok) throw new Error(r.error);
  return r.project;
}
const err = (p: Project, cmd: Command) => {
  const r = applyCommand(p, cmd);
  return r.ok ? null : r.error;
};
const clipOf = (p: Project, id: string) => locate(p, id)!.clip;
const starts = (p: Project, track = 0) => p.tracks[track]!.clips.map((c) => [c.id, c.startFrame, c.durationInFrames]);

describe("move", () => {
  it("moves a clip into free space and keeps the track sorted", () => {
    const p = ok(fixture(), {type: "moveClips", clipIds: ["a"], deltaFrames: 200});
    expect(starts(p)).toEqual([["b", 60, 60], ["c", 120, 60], ["a", 200, 60]]);
  });
  it("refuses an overlap, a negative start, a locked track and the wrong kind of track", () => {
    const p = fixture();
    expect(err(p, {type: "moveClips", clipIds: ["a"], deltaFrames: 30})).toMatch(/overlap/);
    expect(err(p, {type: "moveClips", clipIds: ["b"], deltaFrames: -61})).toBeTruthy();
    expect(err(p, {type: "moveClips", clipIds: ["a"], deltaFrames: 400, toTrackId: "A1"})).toBeTruthy();
    const locked = ok(p, {type: "setTrack", trackId: "V1", patch: {locked: true}});
    expect(err(locked, {type: "moveClips", clipIds: ["c"], deltaFrames: 100})).toBeTruthy();
  });
  it("moves a clip to another track of the same kind", () => {
    let p = ok(fixture(), {type: "addTrack", trackId: "V2", kind: "video"});
    p = ok(p, {type: "moveClips", clipIds: ["b"], deltaFrames: 0, toTrackId: "V2"});
    expect(p.tracks.map((t) => t.id)).toEqual(["V2", "V1", "A1"]);
    expect(p.tracks[0]!.clips.map((c) => c.id)).toEqual(["b"]);
    expect(p.tracks[1]!.clips.map((c) => c.id)).toEqual(["a", "c"]);
  });
  it("moves a selection together; clips in the group do not block each other", () => {
    const p = ok(fixture(), {type: "moveClips", clipIds: ["b", "c"], deltaFrames: 30});
    expect(starts(p)).toEqual([["a", 0, 60], ["b", 90, 60], ["c", 150, 60]]);
  });
  it("resolves a blocked drop to the nearest gap edge", () => {
    const p = fixture();
    expect(resolveMove(p, ["a"], 70)).toBe(0); // onto b: staying put (0) is nearer than after c (180)
    expect(resolveMove(p, ["a"], 150)).toBe(180); // onto c: after c is nearest
    expect(resolveMove(p, ["c"], -50)).toBe(0);
    const spaced = ok(p, {type: "moveClips", clipIds: ["c"], deltaFrames: 100}); // c at 220, gap 120 to 220
    expect(resolveMove(spaced, ["a"], 130)).toBe(130); // fits in the gap
    expect(resolveMove(spaced, ["a"], 170)).toBe(160); // butts against c's start
  });
});

describe("trim", () => {
  it("trims the end and keeps source duration in step", () => {
    const p = ok(fixture(), {type: "trimClip", clipId: "c", edge: "end", deltaFrames: -15});
    expect(clipOf(p, "c")).toMatchObject({durationInFrames: 45, sourceDurationUs: 1_500_000, sourceStartUs: 6_000_000});
  });
  it("trims the start: start, duration and source offset move together", () => {
    let p = ok(fixture(), {type: "trimClip", clipId: "b", edge: "start", deltaFrames: 15});
    expect(clipOf(p, "b")).toMatchObject({startFrame: 75, durationInFrames: 45, sourceStartUs: 4_500_000, sourceDurationUs: 1_500_000});
    p = ok(p, {type: "trimClip", clipId: "b", edge: "start", deltaFrames: -10});
    expect(clipOf(p, "b")).toMatchObject({startFrame: 65, durationInFrames: 55, sourceStartUs: 4_166_667});
  });
  it("clamps at neighbours, at the source and at one frame", () => {
    const p = fixture();
    expect(clampTrim(p, "b", "start", -30)).toBe(0); // a ends where b starts
    expect(clampTrim(p, "a", "end", 30)).toBe(0); // b starts where a ends
    expect(clampTrim(p, "c", "end", 9999)).toBe(60); // 6s in, 2s long, 10s source: 2s left
    expect(clampTrim(p, "c", "end", -9999)).toBe(-59);
    const moved = ok(p, {type: "moveClips", clipIds: ["a"], deltaFrames: 400}); // b now has 60 frames of room before it
    expect(clampTrim(moved, "b", "start", -500)).toBe(-60); // limited by frame 0 here (source has 4s = 120 frames)
  });
  it("never runs past the start of the source", () => {
    const p = ok(fixture(), {type: "moveClips", clipIds: ["a"], deltaFrames: 300}); // a at 300, 2s into the source
    expect(clampTrim(p, "a", "start", -500)).toBe(-60);
  });
  it("lets a still run as long as wanted", () => {
    let p = ok(fixture(), {type: "addTrack", trackId: "V2", kind: "video"});
    p = ok(p, {type: "addAsset", assetId: "still", clipId: "s", trackId: "unused"});
    expect(clipOf(p, "s").durationInFrames).toBe(150);
    p = ok(p, {type: "trimClip", clipId: "s", edge: "end", deltaFrames: 3000});
    expect(clipOf(p, "s").durationInFrames).toBe(3150);
  });
  it("shortens fades that no longer fit", () => {
    let p = ok(fixture(), {type: "updateClip", clipId: "a", patch: {fadeInFrames: 50, fadeOutFrames: 40}});
    p = ok(p, {type: "trimClip", clipId: "a", edge: "end", deltaFrames: -30});
    expect(clipOf(p, "a")).toMatchObject({fadeInFrames: 30, fadeOutFrames: 30});
  });
});

describe("split, delete, duplicate", () => {
  it("splits at a frame; the halves share the asset and continue the source", () => {
    const p = ok(fixture(), {type: "splitClips", frame: 80, clipIds: ["b"], newIds: {b: "b2"}});
    expect(starts(p)).toEqual([["a", 0, 60], ["b", 60, 20], ["b2", 80, 40], ["c", 120, 60]]);
    expect(clipOf(p, "b")).toMatchObject({sourceStartUs: 4_000_000, sourceDurationUs: 666_667});
    expect(clipOf(p, "b2")).toMatchObject({assetId: "v", sourceStartUs: 4_666_667, sourceDurationUs: 1_333_333});
  });
  it("split moves the fade out and the transition to the tail", () => {
    let p = fixture();
    p = ok(p, {type: "updateClip", clipId: "b", patch: {fadeInFrames: 10, fadeOutFrames: 10}});
    p = {...p, tracks: p.tracks.map((t, i) => (i ? t : {...t, clips: t.clips.map((c) => (c.id === "b" ? {...c, transitionOut: {kind: "fade" as const, durationInFrames: 10}} : c))}))};
    p = ok(p, {type: "splitClips", frame: 90, clipIds: ["b"], newIds: {b: "b2"}});
    expect(clipOf(p, "b")).toMatchObject({fadeInFrames: 10, fadeOutFrames: 0});
    expect(clipOf(p, "b").transitionOut).toBeUndefined();
    expect(clipOf(p, "b2")).toMatchObject({fadeInFrames: 0, fadeOutFrames: 10, transitionOut: {kind: "fade", durationInFrames: 10}});
  });
  it("split refuses when the frame is not inside a clip, or is a clip edge", () => {
    expect(err(fixture(), {type: "splitClips", frame: 60, clipIds: ["b"], newIds: {b: "x"}})).toBeTruthy();
  });
  it("splits several clips across tracks at once", () => {
    const p = ok(fixture(), {type: "splitClips", frame: 30, clipIds: ["a", "m1"], newIds: {a: "a2", m1: "m2"}});
    expect(p.tracks[0]!.clips.map((c) => c.id)).toEqual(["a", "a2", "b", "c"]);
    expect(p.tracks[1]!.clips.map((c) => c.id)).toEqual(["m1", "m2"]);
  });
  it("deletes clips and leaves the gap", () => {
    const p = ok(fixture(), {type: "deleteClips", clipIds: ["b", "m1"]});
    expect(starts(p)).toEqual([["a", 0, 60], ["c", 120, 60]]);
    expect(p.tracks[1]!.clips).toEqual([]);
  });
  it("duplicates after the selection, or after the next gap that fits", () => {
    let p = ok(fixture(), {type: "duplicateClips", clipIds: ["c"], newIds: {c: "c2"}});
    expect(starts(p).at(-1)).toEqual(["c2", 180, 60]);
    p = ok(p, {type: "duplicateClips", clipIds: ["a"], newIds: {a: "a2"}}); // b is right after a: goes after c2
    expect(clipOf(p, "a2")).toMatchObject({startFrame: 240, sourceStartUs: 2_000_000});
  });
  it("duplicates a group keeping its arrangement", () => {
    const p = ok(fixture(), {type: "duplicateClips", clipIds: ["a", "b"], newIds: {a: "a2", b: "b2"}});
    expect(starts(p)).toEqual([["a", 0, 60], ["b", 60, 60], ["c", 120, 60], ["a2", 180, 60], ["b2", 240, 60]]);
  });
});

describe("tracks", () => {
  it("adds video on top and audio at the bottom by default", () => {
    let p = ok(fixture(), {type: "addTrack", trackId: "V2", kind: "video"});
    p = ok(p, {type: "addTrack", trackId: "A2", kind: "audio"});
    expect(p.tracks.map((t) => t.id)).toEqual(["V2", "V1", "A1", "A2"]);
  });
  it("reorders, flags and deletes; a locked track cannot be deleted or edited", () => {
    let p = ok(fixture(), {type: "moveTrack", trackId: "A1", toIndex: 0});
    expect(p.tracks.map((t) => t.id)).toEqual(["A1", "V1"]);
    p = ok(p, {type: "setTrack", trackId: "V1", patch: {locked: true, visible: false, muted: true}});
    expect(p.tracks[1]).toMatchObject({locked: true, visible: false, muted: true});
    expect(err(p, {type: "deleteTrack", trackId: "V1"})).toMatch(/locked/);
    expect(err(p, {type: "deleteClips", clipIds: ["a"]})).toMatch(/locked/);
    expect(err(p, {type: "trimClip", clipId: "a", edge: "end", deltaFrames: -5})).toMatch(/locked/);
    p = ok(p, {type: "deleteTrack", trackId: "A1"});
    expect(p.tracks.map((t) => t.id)).toEqual(["V1"]);
  });
});

describe("updateClip and setProject", () => {
  it("merges transform fields and rejects out-of-range values", () => {
    const p = ok(fixture(), {type: "updateClip", clipId: "a", patch: {transform: {x: 40}, fit: "cover"}});
    expect(clipOf(p, "a").transform).toMatchObject({x: 40, y: 0, scale: 1});
    expect(clipOf(p, "a").fit).toBe("cover");
    expect(err(p, {type: "updateClip", clipId: "a", patch: {transform: {opacity: 2}}})).toBeTruthy();
    expect(err(p, {type: "setProject", patch: {backgroundColor: "red"}})).toBeTruthy();
  });
  it("a failed command leaves the project object untouched", () => {
    const p = fixture();
    const r = applyCommand(p, {type: "moveClips", clipIds: ["a"], deltaFrames: 1});
    expect(r.ok).toBe(false);
    expect(p.tracks[0]!.clips[0]!.startFrame).toBe(0);
  });
});

describe("snapping", () => {
  it("collects edges, markers and the playhead, minus the dragged clips", () => {
    const p = {...fixture(), markers: [{id: "k", frame: 75, label: "beat"}]};
    expect(snapPoints(p, {exclude: new Set(["b"]), playhead: 33})).toEqual([0, 33, 60, 75, 120, 180]);
  });
  it("snaps the closest edge within the threshold", () => {
    expect(snap([100, 160], [0, 95, 163, 300], 6)).toEqual({adjust: 3, at: 163});
    expect(snap([100], [0, 120], 6)).toEqual({adjust: 0, at: null});
  });
});

describe("history", () => {
  const run = (h: History, p: Project, cmd: Command, coalesce?: string, at = Date.now()) => {
    const r = applyCommand(p, cmd);
    if (!r.ok) return p;
    h.record({label: cmd.type, patches: r.patches, inverse: r.inverse, coalesce, at});
    return r.project;
  };

  it("undoes and redoes back to identical projects", () => {
    const h = new History();
    const p0 = fixture();
    let p = run(h, p0, {type: "splitClips", frame: 80, clipIds: ["b"], newIds: {b: "b2"}});
    p = run(h, p, {type: "moveClips", clipIds: ["a"], deltaFrames: 400});
    p = run(h, p, {type: "deleteClips", clipIds: ["c"]});
    const p3 = p;
    p = h.undo(h.undo(h.undo(p)!)!)!;
    expect(p).toEqual(p0);
    expect(h.canUndo).toBe(false);
    p = h.redo(h.redo(h.redo(p)!)!)!;
    expect(p).toEqual(p3);
  });
  it("coalesces one gesture into one step, and a new edit clears redo", () => {
    const h = new History();
    const p0 = fixture();
    let p = p0;
    for (let x = 1; x <= 20; x++) p = run(h, p, {type: "updateClip", clipId: "a", patch: {transform: {x}}}, "drag-1", 1000 + x * 16);
    expect(h.size).toBe(1);
    expect(h.undo(p)).toEqual(p0);
    p = run(h, p0, {type: "deleteClips", clipIds: ["a"]});
    expect(h.canRedo).toBe(false);
  });
  it("keeps at most 200 steps", () => {
    const h = new History();
    let p = fixture();
    for (let i = 0; i < 230; i++) p = run(h, p, {type: "setProject", patch: {name: `n${i}`}});
    expect(h.size).toBe(200);
  });

  it("fifty random edits undo to the start and redo to the end, exactly (M4 exit)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const h = new History();
    const p0 = fixture();
    let p = p0;
    let id = 0;
    let applied = 0;
    while (applied < 50) {
      const clips = p.tracks.flatMap((t) => t.clips.map((c) => c.id));
      const c = pick(clips.length ? clips : ["none"]);
      const cmds: Command[] = [
        {type: "moveClips", clipIds: [c], deltaFrames: Math.round(rand() * 200 - 60)},
        {type: "trimClip", clipId: c, edge: rand() < 0.5 ? "start" : "end", deltaFrames: Math.round(rand() * 40 - 20)},
        {type: "splitClips", frame: Math.round(rand() * 300), clipIds: clips, newIds: Object.fromEntries(clips.map((x) => [x, `n${id++}`]))},
        {type: "duplicateClips", clipIds: [c], newIds: {[c]: `d${id++}`}},
        {type: "deleteClips", clipIds: [c]},
        {type: "updateClip", clipId: c, patch: {volume: Math.round(rand() * 200) / 100, transform: {x: Math.round(rand() * 100)}}},
        {type: "addTrack", trackId: `t${id++}`, kind: rand() < 0.5 ? "video" : "audio"},
        {type: "moveTrack", trackId: pick(p.tracks).id, toIndex: Math.floor(rand() * p.tracks.length)},
        {type: "setTrack", trackId: pick(p.tracks).id, patch: {muted: rand() < 0.5}},
      ];
      const before = h.size;
      p = run(h, p, pick(cmds));
      if (h.size > before) applied++;
    }
    const end = p;
    // overlap invariant held throughout
    for (const t of end.tracks) t.clips.forEach((c, i) => i && expect(c.startFrame).toBeGreaterThanOrEqual(t.clips[i - 1]!.startFrame + t.clips[i - 1]!.durationInFrames));
    for (let i = 0; i < 50; i++) p = h.undo(p)!;
    expect(p).toEqual(p0);
    expect(JSON.stringify(p)).toBe(JSON.stringify(p0));
    for (let i = 0; i < 50; i++) p = h.redo(p)!;
    expect(JSON.stringify(p)).toBe(JSON.stringify(end));
  });
});

describe("history gestures", () => {
  it("a gesture key merges however slow the drag is", () => {
    const h = new History();
    const p0 = fixture();
    let p = p0;
    for (let x = 1; x <= 5; x++) {
      const r = applyCommand(p, {type: "updateClip", clipId: "a", patch: {transform: {x}}});
      if (!r.ok) throw new Error(r.error);
      h.record({label: "move", patches: r.patches, inverse: r.inverse, coalesce: "canvas:1", gesture: true, at: x * 5000});
      p = r.project;
    }
    expect(h.size).toBe(1);
    expect(h.undo(p)).toEqual(p0);
  });
});

describe("review fixes", () => {
  it("a start trim can always be dragged back (no microsecond drift trap)", () => {
    for (const d of [1, 4, 7, 10]) {
      let p = ok(fixture(), {type: "moveClips", clipIds: ["a"], deltaFrames: 400});
      p = {...p, tracks: p.tracks.map((t) => ({...t, clips: t.clips.map((c) => (c.id === "a" ? {...c, sourceStartUs: 0} : c))}))};
      p = ok(p, {type: "trimClip", clipId: "a", edge: "start", deltaFrames: d});
      expect(clampTrim(p, "a", "start", -d)).toBe(-d);
      p = ok(p, {type: "trimClip", clipId: "a", edge: "start", deltaFrames: d});
      expect(clampTrim(p, "a", "start", -2 * d)).toBe(-2 * d);
    }
  });
  it("dragging an end handle outward never shortens the clip", () => {
    let p = fixture();
    p = {...p, assets: [...p.assets, asset("short", {durationUs: 1_050_000})]};
    p = ok(p, {type: "addTrack", trackId: "V2", kind: "video"});
    p = {...p, tracks: p.tracks.map((t) => (t.id === "V2" ? {...t, clips: [{...clipOf(p, "a"), id: "s", assetId: "short", startFrame: 0, durationInFrames: 32, sourceStartUs: 0, sourceDurationUs: 1_066_667}]} : t))};
    p = ok(p, {type: "trimClip", clipId: "s", edge: "start", deltaFrames: 2});
    expect(clampTrim(p, "s", "end", 5)).toBe(0);
  });
  it("duplicate ids in a command are ignored, never corrupting tracks", () => {
    let p = ok(fixture(), {type: "addTrack", trackId: "V2", kind: "video"});
    p = ok(p, {type: "moveClips", clipIds: ["c", "c"], deltaFrames: 0, toTrackId: "V2"});
    expect(p.tracks.find((t) => t.id === "V1")!.clips.map((c) => c.id)).toEqual(["a", "b"]);
    expect(p.tracks.find((t) => t.id === "V2")!.clips.map((c) => c.id)).toEqual(["c"]);
    p = ok(p, {type: "deleteClips", clipIds: ["a", "a"]});
    expect(locate(p, "a")).toBeNull();
    p = ok(p, {type: "duplicateClips", clipIds: ["b", "b"], newIds: {b: "b2"}});
    expect(p.tracks.flatMap((t) => t.clips.map((c) => c.id)).filter((id) => id === "b2")).toHaveLength(1);
  });
  it("adding media skips a locked track and uses the next unlocked one of its kind", () => {
    let p = ok(fixture(), {type: "addTrack", trackId: "V0", kind: "video"});
    p = ok(p, {type: "setTrack", trackId: "V0", patch: {locked: true}});
    p = ok(p, {type: "addAsset", assetId: "v", clipId: "n", trackId: "unused"});
    expect(locate(p, "n")!.track.id).toBe("V1");
    p = ok(p, {type: "setTrack", trackId: "V1", patch: {locked: true}});
    p = ok(p, {type: "addAsset", assetId: "v", clipId: "n2", trackId: "Vnew"});
    expect(locate(p, "n2")!.track.id).toBe("Vnew");
  });
  it("random edits across tracks keep the no-overlap invariant after every step and undo exactly", () => {
    for (const s0 of [1, 2, 3]) {
      let seed = s0;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
      const h = new History();
      const p0 = ok(fixture(), {type: "addTrack", trackId: "V2", kind: "video"});
      let p = p0;
      let id = 0;
      for (let step = 0; step < 120; step++) {
        const clips = p.tracks.flatMap((t) => t.clips.map((c) => c.id));
        const c = pick(clips.length ? clips : ["none"]);
        const cmd: Command = pick<Command>([
          {type: "moveClips", clipIds: [c], deltaFrames: Math.round(rand() * 200 - 80), toTrackId: pick(p.tracks).id},
          {type: "moveClips", clipIds: clips.filter(() => rand() < 0.3), deltaFrames: Math.round(rand() * 100 - 30)},
          {type: "trimClip", clipId: c, edge: rand() < 0.5 ? "start" : "end", deltaFrames: Math.round(rand() * 40 - 20)},
          {type: "splitClips", frame: Math.round(rand() * 300), clipIds: clips, newIds: Object.fromEntries(clips.map((x) => [x, `n${id++}`]))},
          {type: "duplicateClips", clipIds: clips.filter(() => rand() < 0.3), newIds: Object.fromEntries(clips.map((x) => [x, `d${id++}`]))},
          {type: "deleteClips", clipIds: [c]},
        ]);
        const r = applyCommand(p, cmd);
        if (!r.ok) continue;
        h.record({label: cmd.type, patches: r.patches, inverse: r.inverse, at: step});
        p = r.project;
        for (const t of p.tracks) t.clips.forEach((x, i) => i && expect(x.startFrame).toBeGreaterThanOrEqual(t.clips[i - 1]!.startFrame + t.clips[i - 1]!.durationInFrames));
      }
      const end = p;
      while (h.canUndo) p = h.undo(p)!;
      expect(JSON.stringify(p)).toBe(JSON.stringify(p0));
      while (h.canRedo) p = h.redo(p)!;
      expect(JSON.stringify(p)).toBe(JSON.stringify(end));
    }
  });
});
