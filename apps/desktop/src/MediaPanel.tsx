import type {Asset} from "@studio/schema";
import {useEffect, useMemo, useRef, useState} from "react";
import {useEditor} from "./editorStore";
import {Close, Film, Import, Link, Music, Picture, Plus, Search, Trash, Warning} from "./icons";
import {formatDuration, importDropped, importWithDialog, relink, removeAssets, useMedia, usedAssetIds} from "./mediaStore";

type Filter = "all" | "video" | "audio" | "image" | "unused" | "missing";
const FILTERS: Filter[] = ["all", "video", "audio", "image", "unused", "missing"];
const extOf = (a: Asset) => a.relativePath.split(".").pop()!;
const STAGE_LABEL = {meta: "Reading", proxy: "Proxy", thumbs: "Thumbnails", peaks: "Audio"} as const;

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
      ctx.fillStyle = "#2dbf9a";
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
  const Icon = asset.type === "audio" ? Music : asset.type === "image" ? Picture : Film;
  const meta = [asset.width && asset.height ? `${asset.width}×${asset.height}` : "", asset.fps ? `${Math.round(asset.fps)} fps` : "", asset.hdr ? "HDR" : ""].filter(Boolean).join(" · ");
  const stage = job?.status === "queued" ? "Queued" : job?.status === "error" ? "Failed" : job ? `${job.stage ? STAGE_LABEL[job.stage] : "Reading"}${job.stage ? ` ${Math.round(job.fraction * 100)}%` : ""}` : "";
  const ensureOne = () => void window.studio.media.ensure(projectId, [{sha256: asset.sha256, ext: extOf(asset), type: asset.type, metaMissing: false}]);

  return (
    <div className={`group rise rounded-lg p-1.5 transition ${selected ? "bg-hover ring-1 ring-accent/70" : "hover:bg-raised"}`} data-testid="asset-tile" data-sha={asset.sha256}>
      <div className="relative aspect-video overflow-hidden rounded-md bg-bg ring-1 ring-line">
        <button className="absolute inset-0" onClick={onSelect} onDoubleClick={() => ready && addToTimeline(asset.id)} disabled={missing} aria-label={asset.name} />
        {missing ? (
          <div className="grid h-full place-items-center bg-warn/5 text-center">
            <div className="grid justify-items-center gap-1 text-warn"><Warning size={16} /><span className="text-[11px] font-medium">File missing</span></div>
          </div>
        ) : asset.type === "audio" ? (
          <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgb(45_191_154/0.14),transparent_70%)]"><Waveform projectId={projectId} sha256={asset.sha256} /></div>
        ) : thumbFailed !== rev ? (
          // eslint-disable-next-line @remotion/warn-native-media-tag -- media panel UI, not a Remotion composition
          <img key={rev} src={`${baseUrl}/cache/${asset.sha256}.thumb.jpg?v=${rev}`} alt="" draggable={false} className="h-full w-full object-contain" onError={() => setThumbFailed(rev)} />
        ) : (
          <div className="shimmer h-full w-full" />
        )}
        {/* badges */}
        {asset.type !== "video" && !missing && <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded bg-black/60 text-dim backdrop-blur"><Icon size={11} /></span>}
        {asset.durationUs !== undefined && asset.type !== "image" && <span className="mono pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-px text-[10px] text-white/90 backdrop-blur">{formatDuration(asset.durationUs)}</span>}
        {used && <span className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" title="On the timeline" />}
        {ready && !missing && (
          <button className="absolute bottom-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-[#1a0b05] opacity-0 shadow-lg transition hover:scale-110 group-hover:opacity-100 focus-visible:opacity-100" title="Add to timeline" aria-label="Add to timeline" onClick={() => addToTimeline(asset.id)}>
            <Plus size={14} />
          </button>
        )}
        {job && <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50"><div className={`h-full ${job.status === "error" ? "bg-danger" : "bg-accent"} transition-[width]`} style={{width: `${Math.max(4, (job.status === "error" ? 1 : job.fraction) * 100)}%`}} /></div>}
      </div>
      <div className="mt-1.5 px-0.5">
        <div className="truncate text-[12px] font-medium" title={asset.name ?? asset.relativePath}>{asset.name ?? asset.relativePath}</div>
        <div className="mt-px flex items-center gap-2 text-[11px] text-faint">
          {job ? <span className={job.status === "error" ? "text-danger" : "text-dim"} title={job.error}>{stage}</span> : <span className="truncate">{meta || asset.type}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {working && <button className="text-dim hover:text-ink" onClick={() => void window.studio.media.cancel(projectId, asset.sha256)}>Cancel</button>}
            {job?.status === "error" && <button className="text-accent hover:underline" onClick={ensureOne}>Retry</button>}
            {!job && asset.type === "video" && !asset.proxyPath && !missing && <button className="text-accent hover:underline" onClick={ensureOne}>Make proxy</button>}
            {missing && <button className="flex items-center gap-1 text-accent hover:underline" onClick={() => void relink(projectId, asset)}><Link size={11} />Relink…</button>}
            <button className="opacity-0 transition hover:text-danger group-hover:opacity-100" title="Remove from project" aria-label="Remove" onClick={() => (used ? window.alert("This asset is used on the timeline.") : void removeAssets(projectId, [asset]))}><Trash size={12} /></button>
          </span>
        </div>
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
  const shown = project.assets.filter((a) => {
    if (query && !(a.name ?? a.relativePath).toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "unused") return !used.has(a.id);
    if (filter === "missing") return !!missing[a.sha256];
    return filter === "all" || a.type === filter;
  });
  return (
    <section
      data-testid="media-panel"
      className={`panel relative flex min-h-0 flex-col transition ${dragging ? "!border-accent" : ""}`}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importDropped(project.id, [...e.dataTransfer.files]);
      }}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="eyebrow mr-auto">Media <span className="ml-1 text-faint/70">{project.assets.length || ""}</span></h2>
        <button className="btn" onClick={() => void importWithDialog(project.id)}><Import size={14} /> Import media…</button>
      </div>
      <div className="grid gap-2 px-3 pb-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"><Search size={13} /></span>
          <input className="field w-full !pl-8" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg w-full justify-between">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} className="capitalize" data-testid={`filter-${f}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      {notice && (
        <div className="rise mx-3 mb-2 flex items-start gap-2 rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-xs text-dim" data-testid="media-notice">
          <span className="flex-1">{notice}</span>
          <button className="text-faint hover:text-ink" aria-label="Dismiss" onClick={() => setNotice(null)}><Close size={12} /></button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {project.assets.length === 0 ? (
          <div className="mx-1 mt-2 grid place-items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-raised text-dim"><Import size={18} /></span>
            <div className="text-[13px] font-medium">Drop clips here</div>
            <div className="max-w-[230px] text-xs text-faint">Video, audio and images from Finder. They are copied into the project, so the originals can move.</div>
          </div>
        ) : (
          <div className="grid gap-x-1 gap-y-1" style={{gridTemplateColumns: "repeat(2, minmax(0, 1fr))"}}>
            {shown.map((a) => <Tile key={a.id} asset={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />)}
          </div>
        )}
        {project.assets.length > 0 && shown.length === 0 && <div className="py-10 text-center text-xs text-faint">Nothing matches.</div>}
      </div>
      <div className="flex items-center border-t border-line px-3 py-2 text-xs text-faint">
        <span>{used.size} of {project.assets.length} on the timeline</span>
        <button
          className="btn btn-ghost ml-auto !h-6 !px-2 text-dim disabled:opacity-30"
          disabled={unused.length === 0}
          onClick={() => window.confirm(`Remove ${unused.length} unused asset${unused.length === 1 ? "" : "s"} and their files from this project?`) && void removeAssets(project.id, unused)}
        >
          <Trash size={12} /> Remove unused ({unused.length})
        </button>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[10px] bg-accent/10 backdrop-blur-[1px]">
          <div className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-[#1a0b05]">Drop to import</div>
        </div>
      )}
    </section>
  );
}
