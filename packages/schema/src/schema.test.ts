import {describe, expect, it} from "vitest";
import {convertProjectFps, createProject, migrateProject, ProjectSchema, ProjectVersionError} from "./index";

const id = "6f1b2c1e-6a43-4a30-9b8e-3c6f5b7d8a10";
const base = () => createProject(id, "Test", {width: 1920, height: 1080, fps: 30});

describe("schema", () => {
  it("creates a valid project with defaults", () => {
    const p = base();
    expect(p.schemaVersion).toBe(1);
    expect(p.backgroundColor).toBe("#000000");
    expect(p.tracks).toEqual([]);
  });
  it("rejects bad fps, size, name and ids", () => {
    expect(() => ProjectSchema.parse({...base(), fps: 29})).toThrow();
    expect(() => ProjectSchema.parse({...base(), width: 0})).toThrow();
    expect(() => ProjectSchema.parse({...base(), name: "  "})).toThrow();
    expect(() => ProjectSchema.parse({...base(), id: "../x"})).toThrow();
  });
  it("migrates through a chain and refuses newer or unknown versions", () => {
    const old = {...base(), schemaVersion: 0, title: "Old"} as Record<string, unknown>;
    const migrations = [{from: 0, to: 1, up: (r: Record<string, unknown>) => ({...r, name: r.title})}];
    expect(migrateProject(old, migrations, 1).name).toBe("Old");
    expect(() => migrateProject({...base(), schemaVersion: 2})).toThrow(ProjectVersionError);
    expect(() => migrateProject({...base(), schemaVersion: 0})).toThrow(/No migration/);
    expect(() => migrateProject({})).toThrow(ProjectVersionError);
  });
  it("converts frame positions through time when fps changes", () => {
    const p = ProjectSchema.parse({
      ...base(),
      tracks: [{id: "t", type: "video", clips: [{id: "c", assetId: "a", startFrame: 30, durationInFrames: 90, transitionOut: {kind: "fade", durationInFrames: 15}}]}],
      markers: [{id: "m", frame: 60, label: "x"}],
    });
    const q = convertProjectFps(p, 60);
    expect(q.fps).toBe(60);
    expect(q.tracks[0]!.clips[0]).toMatchObject({startFrame: 60, durationInFrames: 180});
    expect(q.tracks[0]!.clips[0]!.transitionOut!.durationInFrames).toBe(30);
    expect(q.markers[0]!.frame).toBe(120);
    expect(convertProjectFps(p, 30)).toBe(p);
  });
});
