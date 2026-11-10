// Memory sampler: sums the working set of every Electron process every 250ms and polls swap once a second.
// Optionally logs a CSV (t_ms,total_mb,swap_mb,processes) for `scripts/summarize-run.py`.
import {app} from "electron";
import {execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {MemoryMetrics} from "./ipc";

let swapMB = 0;
let lastSwapPoll = 0;

function pollSwap(now: number): void {
  if (now - lastSwapPoll < 1000) return;
  lastSwapPoll = now;
  execFile("sysctl", ["-n", "vm.swapusage"], (err, out) => {
    if (err) return;
    const m = /used = ([\d.]+)M/.exec(out);
    if (m) swapMB = Number(m[1]);
  });
}

export function startMemorySampler(onSample: (m: MemoryMetrics) => void, csvDir?: string): () => void {
  let stream: fs.WriteStream | null = null;
  if (csvDir) {
    fs.mkdirSync(csvDir, {recursive: true});
    stream = fs.createWriteStream(path.join(csvDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`));
    stream.write("t_ms,total_mb,swap_mb,processes\n");
  }
  const t0 = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    pollSwap(now);
    const byProcess: Record<string, number> = {};
    let totalKB = 0;
    for (const m of app.getAppMetrics()) {
      totalKB += m.memory.workingSetSize;
      byProcess[`${m.type}:${m.pid}`] = Math.round(m.memory.workingSetSize / 1024);
    }
    const totalMB = Math.round(totalKB / 1024);
    stream?.write(`${now - t0},${totalMB},${swapMB},"${JSON.stringify(byProcess).replace(/"/g, "'")}"\n`);
    onSample({totalMB, swapMB, byProcess});
  }, 250);
  return () => {
    clearInterval(timer);
    stream?.end();
  };
}
