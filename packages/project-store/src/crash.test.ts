import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {expect, it} from "vitest";
import {ProjectStore} from "./index";

// M1 exit criterion: killing the app mid-save leaves a loadable project.
it("stays loadable when the writer is SIGKILLed at random moments", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-crash-"));
  const store = new ProjectStore(root);
  await store.init();
  const p = await store.create({name: "Crash", format: {width: 1920, height: 1080, fps: 30}});
  const writer = path.join(path.dirname(fileURLToPath(import.meta.url)), "crash-writer.ts");
  let recoveredCount = 0;
  for (let round = 0; round < 12; round++) {
    const child = spawn(process.execPath, ["--import", "tsx", writer, root, p.id], {stdio: ["ignore", "pipe", "inherit"]});
    await new Promise<void>((resolve) => child.stdout!.once("data", () => resolve()));
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 250));
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    const {project, recovered} = await store.open(p.id);
    expect(project.id).toBe(p.id);
    if (recovered) recoveredCount++;
  }
  console.log(`12 kills, all reopened; ${recoveredCount} needed recovery`);
  await fs.rm(root, {recursive: true, force: true});
}, 60_000);
