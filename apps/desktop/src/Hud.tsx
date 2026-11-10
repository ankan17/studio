import {useEffect, useState} from "react";
import type {MemoryMetrics} from "./ipc";

// Memory HUD: total and per-process working set, plus peak. Bars (8GB Mac): editor tab 600MB, total 1.2GB, export 1.5GB.
export function Hud() {
  const [m, setM] = useState<MemoryMetrics | null>(null);
  const [peak, setPeak] = useState(0);
  useEffect(
    () =>
      window.studio.onMetrics((next) => {
        setM(next);
        setPeak((p) => Math.max(p, next.totalMB));
      }),
    [],
  );
  const procs = m ? Object.entries(m.byProcess).sort((a, b) => b[1] - a[1]) : [];
  return (
    <div className="font-mono text-xs bg-black text-green-300 p-2">
      total {m?.totalMB ?? "-"}MB (peak {peak}MB) | swap used {m?.swapMB ?? "-"}MB
      <div>{procs.map(([k, v]) => `${k} ${v}MB`).join("  ")}</div>
    </div>
  );
}
