import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ProjectStore} from "./index";

let root: string;
let store: ProjectStore;
const fmt = {name: "Trip", format: {width: 1920, height: 1080, fps: 30 as const}};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-store-"));
  store = new ProjectStore(root, {snapshotEveryMs: 0});
  await store.init();
});
afterEach(() => fs.rm(root, {recursive: true, force: true}));

describe("ProjectStore", () => {
  it("creates, lists, saves and reopens", async () => {
    const p = await store.create(fmt);
    expect((await store.list()).map((s) => s.name)).toEqual(["Trip"]);
    await store.save({...p, backgroundColor: "#112233"});
    const {project, recovered} = await store.open(p.id);
    expect(project.backgroundColor).toBe("#112233");
    expect(recovered).toBe(false);
  });
  it("rejects ids that are not UUIDs (path traversal)", async () => {
    await expect(store.open("../etc")).rejects.toThrow(/Invalid project id/);
    await expect(store.delete("../../x")).rejects.toThrow(/Invalid project id/);
  });
  it("refuses to save a project that was never created", async () => {
    const p = await store.create(fmt);
    await store.delete(p.id);
    await expect(store.save(p)).rejects.toThrow();
  });
  it("renames and duplicates (with fps conversion)", async () => {
    const p = await store.create(fmt);
    await store.rename(p.id, "Renamed");
    const d = await store.duplicate(p.id, {fps: 60});
    expect(d.name).toBe("Renamed copy");
    expect(d.fps).toBe(60);
    expect(d.id).not.toBe(p.id);
    expect((await store.list()).length).toBe(2);
  });
  it("deletes through the injected remover", async () => {
    const removed: string[] = [];
    const s = new ProjectStore(root, {remove: async (d) => void removed.push(d)});
    const p = await s.create(fmt);
    await s.delete(p.id);
    expect(removed).toEqual([s.dir(p.id)]);
    expect(await s.list()).toEqual([]);
  });
  it("recovers from a corrupt project.json using a snapshot or the previous copy", async () => {
    const p = await store.create(fmt);
    await store.save({...p, name: "Second"});
    await fs.writeFile(path.join(store.dir(p.id), "project.json"), '{"schemaVersion":1,"id":'); // torn write
    const {project, recovered} = await store.open(p.id);
    expect(recovered).toBe(true);
    expect(project.name).toBe("Second");
  });
  it("ignores leftover temp files from an interrupted save", async () => {
    const p = await store.create(fmt);
    await fs.writeFile(path.join(store.dir(p.id), "project.json.123.abc.tmp"), "partial");
    expect((await store.open(p.id)).project.id).toBe(p.id);
  });
  it("rebuilds a corrupt index by scanning folders", async () => {
    const p = await store.create(fmt);
    await fs.writeFile(path.join(root, "index.json"), "not json");
    expect((await store.list()).map((s) => s.id)).toEqual([p.id]);
  });
  it("recovers the previous save rather than an older snapshot", async () => {
    let t = 1_000_000;
    const s = new ProjectStore(root, {snapshotEveryMs: 60_000, now: () => t++}); // only create() takes a snapshot
    const p = await s.create(fmt);
    for (const name of ["v1", "v2", "v3"]) await s.save({...p, name});
    expect(await fs.readdir(path.join(s.dir(p.id), "recovery"))).toHaveLength(1);
    await fs.writeFile(path.join(s.dir(p.id), "project.json"), "{"); // damaged
    const {project, recovered} = await s.open(p.id);
    expect(recovered).toBe(true);
    expect(project.name).toBe("v2"); // .prev, one save old; the snapshot would lose v1 to v3
  });
  it("recovers the latest save when that save took a snapshot", async () => {
    const p = await store.create(fmt); // snapshotEveryMs 0: every save snapshots
    for (const name of ["v1", "v2"]) await store.save({...p, name});
    await fs.writeFile(path.join(store.dir(p.id), "project.json"), "{");
    expect((await store.open(p.id)).project.name).toBe("v2");
  });
  it("never replaces the previous copy with a damaged project.json", async () => {
    const p = await store.create(fmt);
    await store.save({...p, name: "v1"});
    const file = path.join(store.dir(p.id), "project.json");
    await fs.writeFile(file, "{");
    await store.save({...p, name: "v2"});
    expect(JSON.parse(await fs.readFile(`${file}.prev`, "utf8")).name).toBe("Trip");
  });
  it("keeps 20 snapshots by default", async () => {
    let t = 1;
    const s = new ProjectStore(root, {snapshotEveryMs: 0, now: () => t++});
    const p = await s.create(fmt);
    for (let i = 0; i < 25; i++) await s.save({...p, name: `v${i}`});
    expect((await fs.readdir(path.join(s.dir(p.id), "recovery"))).length).toBe(20);
  });
  it("keeps only the newest snapshots", async () => {
    let t = 1;
    const s = new ProjectStore(root, {snapshotEveryMs: 0, keepSnapshots: 3, now: () => t++});
    const p = await s.create(fmt);
    for (let i = 0; i < 6; i++) await s.save({...p, name: `v${i}`});
    expect((await fs.readdir(path.join(s.dir(p.id), "recovery"))).length).toBe(3);
  });
});
