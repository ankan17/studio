import {FORMAT_PRESETS, FPS_OPTIONS, type Fps} from "@studio/schema";
import {useCallback, useEffect, useState} from "react";
import {useEditor} from "./editorStore";
import {Duplicate, Pencil, Plus, Trash} from "./icons";
import type {ProjectCard} from "./ipc";
import {Roundel, clock} from "./ui";

/** A tiny to-scale frame so each format is recognisable at a glance. */
function AspectGlyph({w, h, active}: {w: number; h: number; active: boolean}) {
  const r = w / h;
  const box = 28;
  const width = r >= 1 ? box : box * r;
  const height = r >= 1 ? box / r : box;
  return <span className="grid h-8 w-8 place-items-center"><span className={`block rounded-[3px] border-[1.5px] ${active ? "border-go bg-go-soft" : "border-ink-3"}`} style={{width, height}} /></span>;
}

function NewProjectDialog({onClose, onCreated}: {onClose: () => void; onCreated: (id: string) => void}) {
  const [name, setName] = useState("Untitled");
  const [formatId, setFormatId] = useState<(typeof FORMAT_PRESETS)[number]["id"]>("landscape");
  const [fps, setFps] = useState<Fps>(30);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const submit = async () => {
    const f = FORMAT_PRESETS.find((p) => p.id === formatId)!;
    try {
      const p = await window.studio.projects.create({name, format: {width: f.width, height: f.height, fps}});
      onCreated(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="scrim-in fixed inset-0 z-20 grid place-items-center bg-ground/75" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="dialog-in panel grid w-[440px] gap-5 p-5 shadow-[0_24px_64px_-12px_rgb(5_7_11/0.7)]" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())}>
        <div>
          <h2 id="new-project-title" className="text-heading font-semibold">New project</h2>
          <p className="mt-1 text-body text-ink-2">Pick the shape of the finished video. You can duplicate the project into another shape later.</p>
        </div>
        <label className="grid gap-1.5 text-label text-ink-2">
          Name
          <input autoFocus className="field !h-9 text-[13px] text-ink" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <div className="grid gap-1.5 text-label text-ink-2" role="group" aria-label="Shape">
          Shape
          <div className="grid grid-cols-2 gap-2">
            {FORMAT_PRESETS.map((p) => (
              <button key={p.id} type="button" aria-pressed={formatId === p.id} onClick={() => setFormatId(p.id)} className={`flex items-center gap-3 rounded-[6px] border px-3 py-2.5 text-left transition-colors duration-150 ${formatId === p.id ? "border-go bg-go-soft" : "border-line bg-raised hover:bg-hover"}`}>
                <AspectGlyph w={p.width} h={p.height} active={formatId === p.id} />
                <span>
                  <span className="block text-label font-medium text-ink">{p.label}</span>
                  <span className="num block text-[11px] leading-4 text-ink-3">{p.width}×{p.height}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5 text-label text-ink-2" role="group" aria-label="Frame rate">
          Frame rate
          <div className="seg">
            {FPS_OPTIONS.map((f) => (
              <button key={f} type="button" className="tnum" aria-pressed={fps === f} onClick={() => setFps(f)}>{f} fps</button>
            ))}
          </div>
          <span className="text-caption text-ink-3">30 fps suits most phone videos.</span>
        </div>
        {error && <div className="text-caption text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-go !h-8 !px-4">Create project</button>
        </div>
      </form>
    </div>
  );
}

function Card({card, onOpen, onChanged}: {card: ProjectCard; onOpen: () => void; onChanged: () => void}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(card.name);
  const aspect = card.width / card.height;
  return (
    <div className="group">
      <button className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-[8px] bg-surface ring-1 ring-line-soft transition-[box-shadow] duration-150 group-hover:ring-line" onClick={onOpen} aria-label={`Open ${card.name}`}>
        {card.thumbnailUrl ? (
          // eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard UI, not a Remotion composition
          <img src={card.thumbnailUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="block rounded-[3px] border border-line" style={{background: card.backgroundColor, aspectRatio: String(aspect), height: aspect > 16 / 9 ? undefined : "56%", width: aspect > 16 / 9 ? "40%" : undefined}} />
        )}
        {card.durationFrames ? <span className="num absolute bottom-2 right-2 rounded-[4px] bg-ground/85 px-1.5 text-[10.5px] leading-4 text-ink">{clock(card.durationFrames / card.fps)}</span> : null}
      </button>
      <div className="mt-2.5 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={(e) => (e.preventDefault(), void window.studio.projects.rename(card.id, name).then(() => (setRenaming(false), onChanged())))}>
              <input autoFocus aria-label="Project name" className="field w-full" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
            </form>
          ) : (
            <div className="truncate text-[13px] font-medium" title={card.name}>{card.name}</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-caption text-ink-3">
            {card.kinds && card.kinds.length > 0 && <span className="flex gap-1">{card.kinds.map((k) => <Roundel key={k} kind={k} />)}</span>}
            <span className="num">{card.width}×{card.height} · {card.fps} fps</span>
          </div>
          <div className="tnum mt-0.5 text-caption text-ink-3">edited {new Date(card.updatedAt).toLocaleDateString(undefined, {month: "short", day: "numeric"})}</div>
        </div>
        <div className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
          <button className="icon-btn !h-7 !w-7" title="Rename" aria-label="Rename" onClick={() => setRenaming(true)}><Pencil size={13} /></button>
          <button className="icon-btn !h-7 !w-7" title="Duplicate" aria-label="Duplicate" onClick={() => void window.studio.projects.duplicate(card.id).then(onChanged)}><Duplicate size={13} /></button>
          <button className="icon-btn !h-7 !w-7 hover:!text-danger" title="Move to Trash" aria-label="Move to Trash" onClick={() => void window.studio.projects.remove(card.id).then((gone) => gone && onChanged())}><Trash size={13} /></button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const open = useEditor((s) => s.open);
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => void window.studio.projects.list().then(setCards, (e) => setError(String(e))), []);
  useEffect(refresh, [refresh]);
  const openProject = (id: string) => void open(id).catch((e) => setError(e instanceof Error ? e.message : String(e)));

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-11 shrink-0 items-center border-b border-line-soft pr-5" style={{paddingLeft: 84}}>
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden><path d="M3 6h16" stroke="var(--color-go)" strokeWidth="3" strokeLinecap="round" /><circle cx="4" cy="6" r="3" fill="var(--color-ground)" stroke="var(--color-ink)" strokeWidth="2" /><circle cx="18" cy="6" r="3" fill="var(--color-ground)" stroke="var(--color-ink)" strokeWidth="2" /></svg>
          Studio
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-8 py-8">
          <div className="mb-7 flex items-center gap-6">
            <div>
              <h1 className="m-0 text-title font-semibold tracking-[-0.01em]">Projects</h1>
              {cards && cards.length > 0 && <p className="tnum m-0 mt-1 text-body text-ink-2">{cards.length} {cards.length === 1 ? "project" : "projects"}, newest first</p>}
            </div>
            {cards && cards.length > 0 && <button className="btn btn-go !h-9 !px-4" onClick={() => setCreating(true)}><Plus size={14} /> New project</button>}
          </div>
          {error && <div className="mb-4 rounded-[6px] border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger" role="alert">{error}</div>}
          {cards?.length === 0 && (
            <div className="measure grid justify-items-start gap-2 rounded-[8px] border border-dashed border-line px-8 py-10">
              <h2 className="m-0 text-heading font-semibold">Make your first video</h2>
              <p className="m-0 text-body text-ink-2">Create a project, import your clips and put them in order on the timeline. Everything is saved as you go, so you can close the app at any time.</p>
              <button className="btn btn-go mt-2 !h-9 !px-4" onClick={() => setCreating(true)}><Plus size={14} /> New project</button>
            </div>
          )}
          <div className="grid gap-x-5 gap-y-7" style={{gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))"}}>
            {cards?.map((c) => <Card key={c.id} card={c} onOpen={() => openProject(c.id)} onChanged={refresh} />)}
          </div>
        </div>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), openProject(id))} />}
    </div>
  );
}
