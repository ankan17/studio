import {FORMAT_PRESETS, FPS_OPTIONS, type Fps} from "@studio/schema";
import {useCallback, useEffect, useState} from "react";
import {useEditor} from "./editorStore";
import {Duplicate, Film, Pencil, Plus, Trash} from "./icons";
import type {ProjectCard} from "./ipc";

/** A tiny to-scale frame so each format is recognisable at a glance. */
function AspectGlyph({w, h, active}: {w: number; h: number; active: boolean}) {
  const r = w / h;
  const box = 28;
  const width = r >= 1 ? box : box * r;
  const height = r >= 1 ? box / r : box;
  return <span className="grid h-8 w-8 place-items-center"><span className={`block rounded-[3px] border-[1.5px] ${active ? "border-accent bg-accent-soft" : "border-faint"}`} style={{width, height}} /></span>;
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
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form className="panel rise grid w-[420px] gap-4 p-5 shadow-[0_30px_80px_rgb(0_0_0/0.6)]" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())}>
        <div>
          <h2 className="text-[15px] font-semibold">New project</h2>
          <p className="mt-0.5 text-xs text-faint">Pick the shape of the final video. You can duplicate the project into another format later.</p>
        </div>
        <label className="grid gap-1.5 text-xs text-dim">
          Name
          <input autoFocus className="field !h-9 text-[13px] text-ink" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <div className="grid gap-1.5 text-xs text-dim">
          Format
          <div className="grid grid-cols-2 gap-2">
            {FORMAT_PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setFormatId(p.id)} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${formatId === p.id ? "border-accent bg-accent-soft" : "border-line-strong bg-raised hover:bg-hover"}`}>
                <AspectGlyph w={p.width} h={p.height} active={formatId === p.id} />
                <span>
                  <span className="block text-[12.5px] font-medium text-ink">{p.label}</span>
                  <span className="mono block text-[10.5px] text-faint">{p.width}×{p.height}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5 text-xs text-dim">
          Frame rate
          <div className="seg w-full">
            {FPS_OPTIONS.map((f) => (
              <button key={f} type="button" className="flex-1 !h-7" aria-pressed={fps === f} onClick={() => setFps(f)}>{f} fps</button>
            ))}
          </div>
        </div>
        {error && <div className="text-xs text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary !h-8 !px-4">Create project</button>
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
    <div className="group rise">
      <button className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl bg-panel ring-1 ring-line transition group-hover:ring-line-strong group-hover:shadow-[0_14px_40px_-10px_rgb(0_0_0/0.7)]" onClick={onOpen} aria-label={`Open ${card.name}`}>
        {card.thumbnailUrl ? (
          // eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard UI, not a Remotion composition
          <img src={card.thumbnailUrl} alt="" draggable={false} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_30%,rgb(255_255_255/0.05),transparent_70%)]">
            <div className="grid place-items-center rounded-[3px] border border-line-strong text-faint" style={{background: card.backgroundColor, aspectRatio: String(aspect), height: aspect > 16 / 9 ? undefined : "58%", width: aspect > 16 / 9 ? "42%" : undefined}}><Film size={16} /></div>
          </div>
        )}
        <span className="mono absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-px text-[10px] text-white/85 backdrop-blur">{card.width}×{card.height}</span>
      </button>
      <div className="mt-2.5 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={(e) => (e.preventDefault(), void window.studio.projects.rename(card.id, name).then(() => (setRenaming(false), onChanged())))}>
              <input autoFocus className="field w-full" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
            </form>
          ) : (
            <div className="truncate text-[13px] font-medium" title={card.name}>{card.name}</div>
          )}
          <div className="mt-0.5 text-[11.5px] text-faint">{card.fps} fps · edited {new Date(card.updatedAt).toLocaleDateString(undefined, {month: "short", day: "numeric"})}</div>
        </div>
        <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button className="icon-btn !h-6 !w-6" title="Rename" onClick={() => setRenaming(true)}><Pencil size={13} /></button>
          <button className="icon-btn !h-6 !w-6" title="Duplicate" onClick={() => void window.studio.projects.duplicate(card.id).then(onChanged)}><Duplicate size={13} /></button>
          <button className="icon-btn !h-6 !w-6 hover:!text-danger" title="Move to Trash" onClick={() => void window.studio.projects.remove(card.id).then((gone) => gone && onChanged())}><Trash size={13} /></button>
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
      <header className="drag flex h-[46px] shrink-0 items-center border-b border-line pr-5" style={{paddingLeft: 84}}>
        <span className="text-[13px] font-semibold tracking-tight">Studio</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-8 py-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Projects</h1>
              <p className="mt-1 text-[13px] text-faint">{cards ? `${cards.length} ${cards.length === 1 ? "project" : "projects"}` : " "}</p>
            </div>
            <button className="btn btn-primary !h-9 !px-4" onClick={() => setCreating(true)}><Plus size={14} /> New project</button>
          </div>
          {error && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
          {cards?.length === 0 && (
            <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-line-strong py-24 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-raised text-dim"><Film size={20} /></span>
              <div className="text-[15px] font-medium">Make your first video</div>
              <div className="max-w-xs text-[13px] text-faint">Create a project, import your clips and cut them together. Everything is saved as you go.</div>
              <button className="btn btn-primary mt-1 !h-9 !px-4" onClick={() => setCreating(true)}><Plus size={14} /> New project</button>
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
