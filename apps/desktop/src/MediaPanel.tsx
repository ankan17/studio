import type {Asset} from "@studio/schema";
import {useEffect, useMemo, useRef, useState} from "react";
import {useEditor} from "./editorStore";
import {Close, Import, Link, Plus, Search, Trash, Warning} from "./icons";
import {formatDuration, importDropped, importWithDialog, relink, removeAssets, useMedia, usedAssetIds} from "./mediaStore";
import {Roundel} from "./ui";

type Filter = "all" | "video" | "audio" | "image" | "unused" | "missing";
const FILTERS: Filter[] = ["all", "video", "audio", "image", "unused", "missing"];
const FILTER_LABEL: Record<Filter, string> = {all: "All", video: "Video", audio: "Audio", image: "Images", unused: "Unused", missing: "Missing"};
const extOf = (a: Asset) => a.relativePath.split(".").pop()!;
const STAGE_LABEL = {meta: "Reading", proxy: "Preview", thumbs: "Thumbnails", peaks: "Waveform"} as const;

function Waveform({projectId, sha256}: {projectId: string; sha256: string}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rev = useMedia((s) => s.rev[sha256] ?? 0);
  useEffect(() => {
    let live = true;
    void window.studio.media.readPeaks(projectId, sha256).then((peaks) => {
      const c = ref.current;
      if (!live || !c || !peaks) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = getComputedStyle(c).getPropertyValue("--color-audio").trim() || "#ad87d7"; // the audio line token
      const per = peaks.length / c.width;
      for (let x = 0; x < c.width; x += 2) {
        let m = 0;
        for (let i = Math.floor(x * per); i < Math.min(peaks.length, Math.ceil((x + 2) * per)); i++) m = Math.max(m, peaks[i]!);
        const h = Math.max(2, (m / 255) * c.height * 0.8);
        ctx.fillRect(x, (c.height - h) / 2, 1.2, h);
      }
    });
    return () => void (live = false);
  }, [projectId, sha256, rev]);
  return <canvas ref={ref} width={320} height={90} className="h-full w-full" />;
}

function Tile({asset, selected, onSelect}: {asset: Asset; selected: boolean; onSelect: () => void}) {
  const projectId = useEditor((s) => s.project!.id);
  const baseUrl = useEditor((s) => s.baseUrl);
  const addToTimeline = useEditor((s) => s.addAssetToTimeline);
  const used = useEditor((s) => usedAssetIds(s.project!.tracks).has(asset.id));
  const job = useMedia((s) => s.jobs[asset.sha256]);
  const rev = useMedia((s) => s.rev[asset.sha256] ?? 0);
  const missing = useMedia((s) => !!s.missing[asset.sha256]);
  const [thumbFailed, setThumbFailed] = useState<number | null>(null);
  const ready = asset.type === "image" || (asset.durationUs ?? 0) > 0;
  const working = job && job.status !== "error";
  const meta = [asset.width && asset.height ? `${asset.width}×${asset.height}` : "", asset.fps ? `${Math.round(asset.fps)} fps` : "", asset.hdr ? "HDR" : ""].filter(Boolean).join(" · ");
  const stage = job?.status === "queued" ? "Waiting…" : job?.status === "error" ? "Could not prepare" : job ? `${job.stage ? STAGE_LABEL[job.stage] : "Reading"}${job.stage ? ` ${Math.round(job.fraction * 100)}%` : ""}` : "";
  const ensureOne = () => void window.studio.media.ensure(projectId, [{sha256: asset.sha256, ext: extOf(asset), type: asset.type, metaMissing: false}]);

  return (
    <div className="group min-w-0" data-testid="asset-tile" data-sha={asset.sha256}>
      <div className={`relative aspect-[16/10] overflow-hidden rounded-[6px] bg-raised outline-offset-1 ${selected ? "outline-2 outline-go" : "outline-0"} ring-1 ring-line-soft`}>
        <button className="absolute inset-0 z-[1]" onClick={onSelect} onDoubleClick={() => ready && addToTimeline(asset.id)} disabled={missing} aria-label={asset.name} />
        {missing ? (
          <div className="relative z-[2] grid h-full place-items-center bg-warn/5 text-center">
            <div className="grid justify-items-center gap-1.5">
              <span className="flex items-center gap-1.5 text-caption font-medium text-warn"><Warning size={14} />File missing</span>
              <button className="btn !h-7 !px-2.5" onClick={() => void relink(projectId, asset)}><Link size={12} />Relink…</button>
            </div>
          </div>
        ) : asset.type === "audio" ? (
          <div className="grid h-full place-items-center px-2"><Waveform projectId={projectId} sha256={asset.sha256} /></div>
        ) : thumbFailed !== rev ? (
          // eslint-disable-next-line @remotion/warn-native-media-tag -- media panel UI, not a Remotion composition
          <img key={rev} src={`${baseUrl}/cache/${asset.sha256}.thumb.jpg?v=${rev}`} alt="" draggable={false} className="h-full w-full bg-ground object-contain" onError={() => setThumbFailed(rev)} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-raised text-caption text-ink-3">No preview</div>
        )}
        {!missing && <Roundel kind={asset.type} className="pointer-events-none absolute left-1.5 top-1.5 z-[2]" />}
        {asset.durationUs !== undefined && asset.type !== "image" && <span className="num pointer-events-none absolute bottom-1.5 right-1.5 z-[2] rounded-[4px] bg-ground/85 px-1.5 text-[10.5px] leading-[16px] text-ink">{formatDuration(asset.durationUs)}</span>}
        {used && <span className="pointer-events-none absolute right-1.5 top-1.5 z-[2] h-2 w-2 rounded-full bg-go ring-2 ring-surface" title="On the timeline" />}
        {ready && !missing && (
          <button className={`absolute bottom-1.5 left-1.5 z-[2] grid h-6 w-6 place-items-center rounded-full bg-go text-go-ink transition-[opacity,transform] duration-150 ease-[var(--ease-out)] active:scale-90 ${used ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""}`} title="Add to the end of the timeline" aria-label="Add to timeline" onClick={() => addToTimeline(asset.id)}>
            <Plus size={14} />
          </button>
        )}
        {job && <div className="absolute inset-x-0 bottom-0 z-[2] h-[3px] bg-ground/70"><div className={`h-full ${job.status === "error" ? "bg-danger" : "bg-go"} transition-[width] duration-300`} style={{width: `${Math.max(4, (job.status === "error" ? 1 : job.fraction) * 100)}%`}} /></div>}
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium leading-4" title={asset.name ?? asset.relativePath}>{asset.name ?? asset.relativePath}</div>
      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-caption text-ink-3">
        {job ? <span className={job.status === "error" ? "text-danger" : "text-ink-2"} title={job.error}>{stage}</span> : <span className="num truncate">{meta || (asset.type === "audio" ? "Audio" : asset.type)}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {working && <button className="text-ink-2 hover:text-ink" onClick={() => void window.studio.media.cancel(projectId, asset.sha256)}>Cancel</button>}
          {job?.status === "error" && <button className="text-go-text hover:underline" onClick={ensureOne}>Retry</button>}
          {!job && asset.type === "video" && !asset.proxyPath && !missing && <button className="text-go-text hover:underline" onClick={ensureOne}>Make preview</button>}
          <button className="opacity-0 transition-opacity duration-150 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100" title="Remove from project" aria-label="Remove" onClick={() => (used ? window.alert("This file is used on the timeline. Remove its clips first.") : void removeAssets(projectId, [asset]))}><Trash size={12} /></button>
        </span>
      </div>
    </div>
  );
}

export function MediaPanel({selectedId, onSelect}: {selectedId: string | null; onSelect: (id: string | null) => void}) {
  const project = useEditor((s) => s.project)!;
  const missing = useMedia((s) => s.missing);
  const notice = useMedia((s) => s.notice);
  const setNotice = useMedia((s) => s.setNotice);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dragging, setDragging] = useState(false);
  const used = useMemo(() => usedAssetIds(project.tracks), [project.tracks]);
  const unused = project.assets.filter((a) => !used.has(a.id));
  const anyMissing = project.assets.some((a) => missing[a.sha256]);
  const filters = FILTERS.filter((f) => f !== "missing" || anyMissing || filter === "missing");
  const shown = project.assets.filter((a) => {
    if (query && !(a.name ?? a.relativePath).toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "unused") return !used.has(a.id);
    if (filter === "missing") return !!missing[a.sha256];
    return filter === "all" || a.type === filter;
  });
  return (
    <section
      data-testid="media-panel"
      className={`panel relative flex w-[340px] shrink-0 flex-col transition-colors duration-150 ${dragging ? "!border-go" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importDropped(project.id, [...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h2 className="text-heading font-semibold">Media</h2>
        {project.assets.length > 0 && <span className="tnum text-caption text-ink-3">{project.assets.length} {project.assets.length === 1 ? "item" : "items"}</span>}
        <span className="flex-1" />
        <button className="btn" onClick={() => void importWithDialog(project.id)}><Import size={14} /> Import media…</button>
      </div>
      <div className="grid gap-2 px-3.5 pb-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"><Search size={13} /></span>
          <input className="field w-full !pl-8" placeholder="Search" aria-label="Search media" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg" role="group" aria-label="Show">
          {filters.map((f) => (
            <button key={f} aria-pressed={filter === f} data-testid={`filter-${f}`} onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</button>
          ))}
        </div>
      </div>
      {notice && (
        <div className="mx-3.5 mb-3 flex items-start gap-2 rounded-[6px] border border-line bg-raised px-2.5 py-1.5 text-caption text-ink-2" data-testid="media-notice" role="status">
          <span className="flex-1">{notice}</span>
          <button className="mt-px text-ink-3 hover:text-ink" aria-label="Dismiss" onClick={() => setNotice(null)}><Close size={12} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
        {project.assets.length === 0 ? (
          <div className="mt-1 grid gap-1.5 rounded-[8px] border border-dashed border-line px-5 py-8">
            <div className="text-[13px] font-semibold">Drop clips here</div>
            <p className="m-0 text-body text-ink-2">Drag videos, music and photos from Finder, or use Import media. They are copied into the project, so the originals can move.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5">
            {shown.map((a) => <Tile key={a.id} asset={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />)}
          </div>
        )}
        {project.assets.length > 0 && shown.length === 0 && <div className="py-10 text-center text-body text-ink-2">Nothing matches.</div>}
      </div>
      <div className="flex items-center border-t border-line-soft px-3.5 py-2 text-caption text-ink-3">
        <span className="tnum">{used.size} of {project.assets.length} on the timeline</span>
        <button
          className="btn btn-ghost ml-auto !h-6 !px-2 disabled:opacity-40"
          disabled={unused.length === 0}
          onClick={() => window.confirm(`Remove ${unused.length} unused file${unused.length === 1 ? "" : "s"} from this project? Their copies in the project folder are deleted.`) && void removeAssets(project.id, unused)}
        >
          <Trash size={12} /> Remove unused ({unused.length})
        </button>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[8px] bg-go/10">
          <div className="rounded-[6px] bg-go px-3 py-1.5 text-label font-semibold text-go-ink">Drop to import</div>
        </div>
      )}
    </section>
  );
}
