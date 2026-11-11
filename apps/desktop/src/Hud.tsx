import {useEffect, useState} from "react";
import type {MemoryMetrics} from "./ipc";

// Memory readout in the status bar. Bars (8GB Mac): editor tab 600MB, total 1.2GB, export 1.5GB. Turns amber near the bar.
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
  const hot = (m?.totalMB ?? 0) > 1000;
  return (
    <div className="mono flex items-center gap-3 text-[10.5px] text-faint" data-testid="hud">
      <span className={hot ? "text-warn" : "text-dim"}>Memory {m?.totalMB ?? "–"} MB</span>
      <span>peak {peak}</span>
      <span>swap {m ? Math.round(m.swapMB) : "–"}</span>
      <span className="hidden truncate lg:inline">{procs.map(([k, v]) => `${k} ${v}`).join("  ")}</span>
    </div>
  );
}
