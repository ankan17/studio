import {ProjectSchema, SCHEMA_VERSION, type Project} from "./index";

// Migration scaffold. To change the schema: bump SCHEMA_VERSION, keep the old shape's migration here,
// and add a fixture test. Each migration takes raw JSON at version `from` and returns raw JSON at `to`.
export type Migration = {from: number; to: number; up: (raw: Record<string, unknown>) => Record<string, unknown>};

export const MIGRATIONS: Migration[] = []; // schema v1 is the first version: nothing to migrate yet

export class ProjectVersionError extends Error {}

export function migrateProject(raw: unknown, migrations: Migration[] = MIGRATIONS, target = SCHEMA_VERSION): Project {
  if (typeof raw !== "object" || raw === null || typeof (raw as {schemaVersion?: unknown}).schemaVersion !== "number") {
    throw new ProjectVersionError("Not a project file: missing schemaVersion.");
  }
  let doc = raw as Record<string, unknown>;
  let version = doc.schemaVersion as number;
  if (version > target) throw new ProjectVersionError(`Project is from a newer version (schema ${version}); this app supports up to ${target}.`);
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new ProjectVersionError(`No migration from schema ${version}.`);
    doc = {...step.up(doc), schemaVersion: step.to};
    version = step.to;
  }
  return ProjectSchema.parse(doc);
}
