import fs from "node:fs/promises";
import path from "node:path";

// Write to a temp file in the same folder, fsync it, then rename over the target. A crash at any point leaves
// either the old file or the new file, never a half-written target (rename is atomic on the same volume).
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
  try {
    const dir = await fs.open(path.dirname(target), "r");
    await dir.sync(); // make the rename itself durable; best effort
    await dir.close();
  } catch {
    /* directory fsync is not available everywhere */
  }
}
