import {FORMAT_PRESETS, FPS_OPTIONS, type Fps} from "@studio/schema";
import {useCallback, useEffect, useState} from "react";
import type {ProjectCard} from "./ipc";
import {useEditor} from "./editorStore";

function NewProjectDialog({onClose, onCreated}: {onClose: () => void; onCreated: (id: string) => void}) {
  const [name, setName] = useState("Untitled");
  const [formatId, setFormatId] = useState<(typeof FORMAT_PRESETS)[number]["id"]>("landscape");
  const [fps, setFps] = useState<Fps>(30);
  const [error, setError] = useState<string | null>(null);
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
    <div className="fixed inset-0 grid place-items-center bg-black/60" onClick={onClose}>
      <form className="grid w-96 gap-3 rounded bg-zinc-800 p-5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), void submit())}>
        <h2 className="text-lg font-semibold">New project</h2>
        <label className="grid gap-1 text-sm">
          Name
          <input autoFocus className="rounded bg-zinc-700 px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {FORMAT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`rounded border px-2 py-2 text-left text-sm ${formatId === p.id ? "border-sky-500 bg-sky-950" : "border-zinc-600"}`}
              onClick={() => setFormatId(p.id)}
            >
              {p.label}
              <div className="text-xs text-zinc-400">{p.width} x {p.height}</div>
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-sm">
          Frame rate
          <select className="rounded bg-zinc-700 px-2 py-1" value={fps} onChange={(e) => setFps(Number(e.target.value) as Fps)}>
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>
        </label>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="rounded bg-sky-600 px-3 py-1">Create</button>
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
    <div className="grid gap-2 rounded bg-zinc-800 p-3">
      <button className="grid place-items-center overflow-hidden rounded" style={{aspectRatio: "16 / 9", background: "#111"}} onClick={onOpen}>
        {card.thumbnailUrl ? (
          // eslint-disable-next-line @remotion/warn-native-media-tag -- dashboard UI, not a Remotion composition
          <img src={card.thumbnailUrl} alt="" className="max-h-full max-w-full" />
        ) : (
          <div style={{background: card.backgroundColor, aspectRatio: String(aspect), height: aspect > 16 / 9 ? undefined : "100%", width: aspect > 16 / 9 ? "100%" : undefined}} className="border border-zinc-600" />
        )}
      </button>
      {renaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void window.studio.projects.rename(card.id, name).then(() => (setRenaming(false), onChanged()));
          }}
        >
          <input autoFocus className="w-full rounded bg-zinc-700 px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
        </form>
      ) : (
        <div className="truncate font-medium" title={card.name}>{card.name}</div>
      )}
      <div className="text-xs text-zinc-400">
        {card.width} x {card.height} · {card.fps} fps · {new Date(card.updatedAt).toLocaleString()}
      </div>
      <div className="flex gap-3 text-xs">
        <button className="text-sky-400" onClick={onOpen}>Open</button>
        <button className="text-sky-400" onClick={() => setRenaming(true)}>Rename</button>
        <button className="text-sky-400" onClick={() => void window.studio.projects.duplicate(card.id).then(onChanged)}>Duplicate</button>
        <button className="text-red-400" onClick={() => void window.studio.projects.remove(card.id).then((gone) => gone && onChanged())}>Delete</button>
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
    <div className="grid gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <button className="rounded bg-sky-600 px-3 py-1" onClick={() => setCreating(true)}>New project</button>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {cards?.length === 0 && <div className="text-zinc-400">No projects yet. Create one to get started.</div>}
      <div className="grid gap-4" style={{gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))"}}>
        {cards?.map((c) => <Card key={c.id} card={c} onOpen={() => openProject(c.id)} onChanged={refresh} />)}
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), openProject(id))} />}
    </div>
  );
}
