import {EXPORT_HEIGHTS, exportSize, projectDurationFrames, type ExportRecord} from "@studio/schema";
import {useEffect} from "react";
import {useEditor} from "./editorStore";
import {useExport} from "./exportStore";
import {Check, Close, Warning} from "./icons";
import {clock} from "./ui";

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);

function Outcome({record}: {record: ExportRecord}) {
  if (record.status === "done") {
    return (
      <div className="flex items-start gap-2 rounded-[6px] border border-line bg-raised px-3 py-2.5 text-body" role="status" data-testid="export-done">
        <span className="mt-0.5 text-go-text"><Check size={14} /></span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{record.fileName}</span>
          <span className="num text-caption text-ink-2">{mb(record.sizeBytes)} · {clock(record.elapsedMs / 1000)} to export</span>
        </span>
      </div>
    );
  }
  return (
    <div className={`flex items-start gap-2 rounded-[6px] border px-3 py-2.5 text-body ${record.status === "failed" ? "border-danger/40 bg-danger/10 text-danger" : "border-line bg-raised text-ink-2"}`} role={record.status === "failed" ? "alert" : "status"} data-testid={`export-${record.status}`}>
      <span className="mt-0.5"><Warning size={14} /></span>
      <span className="min-w-0">
        {record.status === "cancelled" ? "Export cancelled. No file was kept." : "The export did not finish."}
        {record.error && <span className="block break-words text-caption">{record.error}</span>}
        {record.status === "failed" && <span className="block text-caption text-ink-3">A log of this export is in the project's exports folder.</span>}
      </span>
    </div>
  );
}

export function ExportDialog() {
  const project = useEditor((s) => s.project)!;
  const {open, height, running, last, history, startError, setOpen, setHeight, start, cancel} = useExport();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;

  const total = projectDurationFrames(project);
  const seconds = total / project.fps;
  return (
    <div className="scrim-in fixed inset-0 z-20 grid place-items-center bg-ground/75" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="dialog-in panel grid max-h-[90vh] w-[460px] gap-5 overflow-auto p-5 shadow-[0_24px_64px_-12px_rgb(5_7_11/0.7)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="export-title" className="text-heading font-semibold">Export video</h2>
            <p className="mt-1 text-body text-ink-2">An MP4 you can upload anywhere. You choose where to save it.</p>
          </div>
          <button className="btn btn-ghost !px-2" onClick={() => setOpen(false)} aria-label="Close"><Close size={14} /></button>
        </div>

        {running ? (
          <div className="grid gap-2" data-testid="export-running">
            <div className="flex items-baseline justify-between text-body">
              <span className="min-w-0 truncate font-medium">{running.fileName}</span>
              <span className="num text-ink-2" data-testid="export-percent">{Math.round(running.fraction * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(running.fraction * 100)}>
              <div className="h-full bg-go" style={{width: `${running.fraction * 100}%`}} />
            </div>
            <div className="num text-caption text-ink-3">{running.etaMs === null ? "Estimating time…" : `About ${clock(Math.max(1, Math.round(running.etaMs / 1000)))} left`}</div>
            <div className="flex justify-end"><button className="btn btn-ghost" onClick={() => void cancel()}>Cancel export</button></div>
          </div>
        ) : (
          <>
            <div className="grid gap-1.5 text-label text-ink-2" role="group" aria-label="Size">
              Size
              <div className="seg">
                {EXPORT_HEIGHTS.map((h) => {
                  const s = exportSize(project.width, project.height, h);
                  return (
                    <button key={h} type="button" className="tnum" aria-pressed={height === h} onClick={() => setHeight(h)}>{h}p · {s.width}×{s.height}</button>
                  );
                })}
              </div>
              <span className="text-caption text-ink-3">{project.fps} fps, same as the project · {clock(seconds)} long</span>
            </div>
            {last && <Outcome record={last} />}
            {startError && <div className="text-caption text-danger" role="alert" data-testid="export-start-error">{startError}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
              <button className="btn btn-go !h-8 !px-4" onClick={() => void start()} disabled={total === 0} data-testid="export-start">Export…</button>
            </div>
          </>
        )}

        {history.length > 0 && (
          <div className="grid gap-1.5 border-t border-line-soft pt-4" data-testid="export-history">
            <div className="text-label text-ink-2">Earlier exports</div>
            <ul className="m-0 grid list-none gap-1 p-0">
              {[...history].reverse().map((r) => (
                <li key={r.id} className="flex items-baseline gap-2 text-caption" data-status={r.status}>
                  <span className="min-w-0 flex-1 truncate text-ink">{r.fileName}</span>
                  <span className="num text-ink-3">{r.status === "done" ? `${r.outputHeight}p · ${mb(r.sizeBytes)}` : r.status}</span>
                  <span className="num text-ink-3">{new Date(r.startedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
