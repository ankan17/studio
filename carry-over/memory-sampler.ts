// Memory sampler: runs in the main process. Sums working set across every Electron process
// every 250ms and logs swap used every second. Writes spike/runs/<experiment>-<timestamp>.csv.
import {app} from "electron";
import {execFile} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type MemorySample = {t: number; totalMB: number; byProcess: Record<string, number>; swapMB: number};

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

export function startMemorySampler(experiment: string, runsDir: string, onSample?: (s: MemorySample) => void) {
  if (experiment !== "live") fs.mkdirSync(runsDir, {recursive: true});
  const file = path.join(runsDir, `${experiment}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  const persist = experiment !== "live";
  const stream = persist ? fs.createWriteStream(file) : null;
  stream?.write("t_ms,total_mb,swap_mb,processes\n");
  const t0 = Date.now();
  let peakTotal = 0;
  let baselineSwap = -1;
  let peakSwapGrowth = 0;

  const timer = setInterval(() => {
    const now = Date.now();
    pollSwap(now);
    const byProcess: Record<string, number> = {};
    let totalKB = 0;
    for (const m of app.getAppMetrics()) {
      const kb = m.memory.workingSetSize;
      totalKB += kb;
      const key = `${m.type}:${m.pid}`;
      byProcess[key] = Math.round(kb / 1024);
    }
    const totalMB = Math.round(totalKB / 1024);
    if (baselineSwap < 0) baselineSwap = swapMB;
    peakTotal = Math.max(peakTotal, totalMB);
    peakSwapGrowth = Math.max(peakSwapGrowth, swapMB - baselineSwap);
    stream?.write(`${now - t0},${totalMB},${swapMB},"${JSON.stringify(byProcess).replace(/"/g, "'")}"\n`);
    onSample?.({t: now - t0, totalMB, byProcess, swapMB});
  }, 250);

  return {
    file,
    stop: () => {
      clearInterval(timer);
      stream?.end();
      return {file, peakTotalMB: peakTotal, peakSwapGrowthMB: peakSwapGrowth};
    },
  };
}
