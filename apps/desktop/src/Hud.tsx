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
  const detail = m ? `swap ${Math.round(m.swapMB)} MB\n${procs.map(([k, v]) => `${k} ${v} MB`).join("\n")}` : undefined;
  return (
    <div className="num flex min-w-0 items-center gap-3 text-[11px] text-ink-3" data-testid="hud" title={detail}>
      <span className={hot ? "text-warn" : "text-ink-2"}>Memory {m?.totalMB ?? "–"} MB</span>
      <span>peak {peak}</span>
    </div>
  );
}
