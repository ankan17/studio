// Export history: <project>/exports.json (a list of finished, failed and cancelled exports) and one log file per
// export in <project>/exports/<id>.log. Kept out of project.json on purpose: history is not part of the edit, so
// exporting never dirties the project and the schema stays at v1.
import {ExportRecordSchema, type ExportRecord} from "@studio/schema";
import fs from "node:fs/promises";
import path from "node:path";
import {writeFileAtomic} from "./atomic";

export const exportsFile = (projectDir: string): string => path.join(projectDir, "exports.json");
export const exportLogFile = (projectDir: string, exportId: string): string => {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new Error("Invalid export id.");
  return path.join(projectDir, "exports", `${exportId}.log`);
};

/** Oldest first. A missing or damaged file is an empty history; entries that no longer validate are dropped. */
export async function readExports(projectDir: string): Promise<ExportRecord[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(exportsFile(projectDir), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const parsed = ExportRecordSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function addExport(projectDir: string, record: ExportRecord): Promise<ExportRecord[]> {
  const all = [...(await readExports(projectDir)), ExportRecordSchema.parse(record)];
  await writeFileAtomic(exportsFile(projectDir), JSON.stringify(all, null, 2));
  return all;
}
