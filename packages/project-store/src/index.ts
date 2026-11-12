// Project folder manager. Layout:
//   <root>/index.json                 mirror of project summaries (rebuildable by scanning)
//   <root>/<id>/project.json          source of truth
//   <root>/<id>/project.json.prev     previous good copy
//   <root>/<id>/recovery/<ms>.json    periodic snapshots (newest 20 kept)
//   <root>/<id>/assets, cache, thumbnail.jpg
// Ids come from the renderer, so every id is checked to be a UUID before it touches a path.
import {convertProjectFps, createProject, migrateProject, projectDurationFrames, type Fps, type Project} from "@studio/schema";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {writeFileAtomic} from "./atomic";

export {writeFileAtomic};
export * from "./assets";
export * from "./exports";

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  hasThumbnail: boolean;
  /** Timeline length; absent in index files written before it existed. */
  durationFrames?: number;
  /** Media types on the timeline, in video, audio, image order; absent in older index files. */
  kinds?: ("video" | "audio" | "image")[];
};
export type OpenResult = {project: Project; recovered: boolean};
export type StoreOptions = {
  /** How to delete a project folder. Default removes it; the app passes "move to trash". */
  remove?: (dir: string) => Promise<void>;
  now?: () => number;
  snapshotEveryMs?: number;
  keepSnapshots?: number;
};

function isValidProject(json: string): boolean {
  try {
    migrateProject(JSON.parse(json));
    return true;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ProjectStore {
  private readonly now: () => number;
  private readonly remove: (dir: string) => Promise<void>;
  private readonly snapshotEveryMs: number;
  private readonly keepSnapshots: number;
  private readonly lastSnapshot = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly root: string,
    opts: StoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.remove = opts.remove ?? ((dir) => fs.rm(dir, {recursive: true, force: true}));
    this.snapshotEveryMs = opts.snapshotEveryMs ?? 30_000;
    this.keepSnapshots = opts.keepSnapshots ?? 20;
  }

  // All mutations run one at a time so index and project writes never interleave.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  dir(id: string): string {
    if (!UUID.test(id)) throw new Error("Invalid project id.");
    return path.join(this.root, id);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, {recursive: true});
  }

  // ---- reading
  private async readValid(file: string): Promise<Project | null> {
    try {
      return migrateProject(JSON.parse(await fs.readFile(file, "utf8")));
    } catch {
      return null;
    }
  }

  async open(id: string): Promise<OpenResult> {
    const dir = this.dir(id);
    const main = await this.readValid(path.join(dir, "project.json"));
    if (main && main.id === id) return {project: main, recovered: false};
    // project.json missing or damaged: the most recently written valid copy wins. `.prev` is one save old, while the
    // newest snapshot can be up to snapshotEveryMs old, or the latest save itself when that save took one. Ties go to
    // the snapshot (written after `.prev` in the same save); the sort is stable and snapshots come first.
    const candidates: string[] = [];
    try {
      const names = (await fs.readdir(path.join(dir, "recovery"))).filter((n) => n.endsWith(".json")).sort().reverse();
      candidates.push(...names.map((n) => path.join(dir, "recovery", n)));
    } catch {
      /* no snapshots */
    }
    candidates.push(path.join(dir, "project.json.prev"));
    const dated = await Promise.all(candidates.map(async (file) => ({file, t: (await fs.stat(file).catch(() => null))?.mtimeMs})));
    const ordered = dated.filter((d): d is {file: string; t: number} => d.t !== undefined).sort((a, b) => b.t - a.t);
    for (const {file} of ordered) {
      const p = await this.readValid(file);
      if (p && p.id === id) return {project: p, recovered: true};
    }
    throw new Error("Project could not be opened: no valid copy found.");
  }

  private async summarise(project: Project, updatedAt: number): Promise<ProjectSummary> {
    let hasThumbnail = false;
    try {
      await fs.access(path.join(this.dir(project.id), "thumbnail.jpg"));
      hasThumbnail = true;
    } catch {
      /* none yet */
    }
    const {id, name, width, height, fps, backgroundColor} = project;
    const onTimeline = new Set(project.tracks.flatMap((t) => t.clips.map((c) => project.assets.find((a) => a.id === c.assetId)?.type)));
    const kinds = (["video", "audio", "image"] as const).filter((k) => onTimeline.has(k));
    return {id, name, width, height, fps, backgroundColor, hasThumbnail, updatedAt: new Date(updatedAt).toISOString(), durationFrames: projectDurationFrames(project), kinds};
  }

  private async readIndex(): Promise<ProjectSummary[] | null> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.root, "index.json"), "utf8"));
      return Array.isArray(raw) ? (raw as ProjectSummary[]) : null;
    } catch {
      return null;
    }
  }

  private async writeIndex(list: ProjectSummary[]): Promise<void> {
    await writeFileAtomic(path.join(this.root, "index.json"), JSON.stringify(list, null, 2));
  }

  private async rebuildIndex(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const entry of await fs.readdir(this.root, {withFileTypes: true})) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try {
        const {project} = await this.open(entry.name);
        const stat = await fs.stat(path.join(this.root, entry.name, "project.json")).catch(() => null);
        out.push(await this.summarise(project, stat?.mtimeMs ?? this.now()));
      } catch {
        /* unreadable folder: skipped, left on disk */
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.writeIndex(out);
    return out;
  }

  list(): Promise<ProjectSummary[]> {
    return this.serial(async () => {
      const idx = await this.readIndex();
      if (!idx) return this.rebuildIndex();
      // drop entries whose folder is gone
      const alive: ProjectSummary[] = [];
      for (const s of idx) {
        try {
          await fs.access(path.join(this.dir(s.id), "project.json"));
          alive.push(s);
        } catch {
          /* gone */
        }
      }
      return alive.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  private async upsertIndex(project: Project): Promise<void> {
    const idx = (await this.readIndex()) ?? [];
    const next = idx.filter((s) => s.id !== project.id);
    next.push(await this.summarise(project, this.now()));
    await this.writeIndex(next);
  }

  // ---- writing
  private async writeProject(project: Project): Promise<void> {
    const dir = this.dir(project.id);
    await fs.mkdir(path.join(dir, "recovery"), {recursive: true});
    const file = path.join(dir, "project.json");
    const json = JSON.stringify(project, null, 2);
    // Keep the previous good copy first. Written fresh rather than copied, so it is atomic and its mtime says when it
    // became the previous copy (open() compares it with the snapshots). A damaged project.json never replaces it.
    const previous = await fs.readFile(file, "utf8").catch(() => null);
    if (previous !== null && isValidProject(previous)) await writeFileAtomic(`${file}.prev`, previous);
    await writeFileAtomic(file, json);
    const t = this.now();
    if (t - (this.lastSnapshot.get(project.id) ?? 0) >= this.snapshotEveryMs) {
      this.lastSnapshot.set(project.id, t);
      await writeFileAtomic(path.join(dir, "recovery", `${String(t).padStart(15, "0")}.json`), json);
      const names = (await fs.readdir(path.join(dir, "recovery"))).filter((n) => n.endsWith(".json")).sort();
      for (const old of names.slice(0, Math.max(0, names.length - this.keepSnapshots))) await fs.rm(path.join(dir, "recovery", old), {force: true});
    }
  }

  create(input: {name: string; format: {width: number; height: number; fps: Fps}}): Promise<Project> {
    return this.serial(async () => {
      const project = createProject(randomUUID(), input.name, input.format);
      await this.writeProject(project);
      await this.upsertIndex(project);
      return project;
    });
  }

  save(project: Project): Promise<void> {
    return this.serial(async () => {
      await fs.access(this.dir(project.id)); // saving never creates a project folder
      await this.writeProject(project);
      await this.upsertIndex(project);
    });
  }

  rename(id: string, name: string): Promise<Project> {
    return this.serial(async () => {
      const {project} = await this.open(id);
      const next = createProjectCopy(project, {name});
      await this.writeProject(next);
      await this.upsertIndex(next);
      return next;
    });
  }

  duplicate(id: string, opts: {fps?: Fps} = {}): Promise<Project> {
    return this.serial(async () => {
      const {project} = await this.open(id);
      const newId = randomUUID();
      const from = this.dir(id);
      const to = this.dir(newId);
      await fs.mkdir(to, {recursive: true});
      for (const entry of await fs.readdir(from, {withFileTypes: true})) {
        if (entry.name === "recovery" || entry.name.endsWith(".tmp") || entry.name === "project.json.prev") continue;
        await fs.cp(path.join(from, entry.name), path.join(to, entry.name), {recursive: true});
      }
      let copy = createProjectCopy(project, {id: newId, name: `${project.name} copy`});
      if (opts.fps) copy = convertProjectFps(copy, opts.fps);
      await this.writeProject(copy);
      await this.upsertIndex(copy);
      return copy;
    });
  }

  delete(id: string): Promise<void> {
    return this.serial(async () => {
      await this.remove(this.dir(id));
      this.lastSnapshot.delete(id);
      const idx = (await this.readIndex()) ?? [];
      await this.writeIndex(idx.filter((s) => s.id !== id));
    });
  }

  setThumbnail(id: string, jpeg: Uint8Array): Promise<void> {
    return this.serial(async () => {
      await writeFileAtomic(path.join(this.dir(id), "thumbnail.jpg"), jpeg);
      const {project} = await this.open(id);
      await this.upsertIndex(project);
    });
  }

  thumbnailPath(id: string): string {
    return path.join(this.dir(id), "thumbnail.jpg");
  }
}

function createProjectCopy(p: Project, patch: Partial<Pick<Project, "id" | "name">>): Project {
  return {...p, ...patch};
}
