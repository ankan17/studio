import {useEffect, useState} from "react";
import {useEditor, type SaveState} from "./editorStore";
import {Back, Check, Warning} from "./icons";
import {Hud} from "./Hud";
import {Inspector} from "./Inspector";
import {MediaPanel} from "./MediaPanel";
import {ensureMedia, handleMediaEvent, useMedia} from "./mediaStore";
import {playback} from "./playback";
import {SequenceStrip} from "./SequenceStrip";
import {Stage} from "./Stage";
import {Transport} from "./Transport";

// Saved is a quiet ink tick, not a colour: gold would sit too close to the orange "unsaved" dot.
const SAVE: Record<SaveState, {label: string; dot: string | null}> = {
  saved: {label: "Saved", dot: null},
  dirty: {label: "Unsaved changes", dot: "bg-warn"},
  saving: {label: "Saving…", dot: "bg-warn"},
  error: {label: "Could not save", dot: "bg-danger"},
};

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function Editor() {
  const {project, recovered, saveState, error, update, close} = useEditor();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);

  // Worker events and the open-time check (queue missing proxies, find missing files) live as long as the project is open.
  useEffect(() => {
    if (!projectId) return;
    useMedia.getState().reset();
    playback.reset();
    const off = window.studio.media.onEvent(handleMediaEvent);
    void ensureMedia(projectId, useEditor.getState().project?.assets ?? []);
    return () => {
      off();
      void window.studio.media.cancel(projectId); // leaving the project stops its queue; reopening resumes it
    };
  }, [projectId]);

  // Keyboard: the same functions the buttons call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const fps = useEditor.getState().project?.fps ?? 30;
      const hit = (fn: () => void) => (e.preventDefault(), fn());
      if (e.code === "Space") hit(playback.toggle);
      else if (e.code === "ArrowLeft") hit(() => playback.step(e.shiftKey ? -fps : -1));
      else if (e.code === "ArrowRight") hit(() => playback.step(e.shiftKey ? fps : 1));
      else if (e.code === "Home") hit(playback.toStart);
      else if (e.code === "End") hit(playback.toEnd);
      else if (e.code === "Escape") hit(() => useEditor.getState().selectClip(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) return null;
  const save = SAVE[saveState];
  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-11 shrink-0 items-center gap-3 border-b border-line-soft pr-4" style={{paddingLeft: 84}}>
        <button className="btn btn-ghost no-drag -ml-1 !px-2" onClick={() => void close()} title="Back to all projects"><Back size={14} /> Projects</button>
        <span className="h-4 w-px bg-line" />
        <input
          className="no-drag h-7 min-w-[80px] max-w-[320px] rounded-[6px] [field-sizing:content] border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition-colors duration-150 hover:border-line focus:border-go focus:bg-ground"
          value={project.name}
          aria-label="Project name"
          onChange={(e) => update((p) => void (p.name = e.target.value))}
          onBlur={(e) => !e.target.value.trim() && update((p) => void (p.name = "Untitled"))}
        />
        <span className="no-drag flex items-center gap-1.5 text-caption text-ink-2" title={error ?? undefined} data-testid="save-state">
          {save.dot ? <span className={`h-1.5 w-1.5 rounded-full ${save.dot}`} /> : <span className="-mx-0.5 text-ink-3"><Check size={12} /></span>}
          {save.label}
        </span>
        <div className="flex-1" />
        <label className="no-drag flex items-center gap-2 text-caption text-ink-2" title="Colour behind clips that do not fill the frame">
          Background
          <input type="color" className="h-5 w-5 cursor-pointer appearance-none rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0" value={project.backgroundColor} onChange={(e) => update((p) => void (p.backgroundColor = e.target.value))} />
        </label>
      </header>
      {recovered && (
        <div className="mx-2.5 mt-2.5 flex items-center gap-2 rounded-[6px] border border-warn/30 bg-warn/10 px-3 py-2 text-caption text-warn" role="status">
          <Warning size={14} />
          This project was restored from a recovery copy because its main file was damaged. Check your latest changes.
        </div>
      )}
      <main className="flex min-h-0 flex-1 gap-2.5 p-2.5 pb-0">
        <MediaPanel selectedId={selected} onSelect={setSelected} />
        <section className="panel flex min-w-0 flex-1 flex-col px-3.5 pb-2 pt-3">
          <Stage />
          <Transport />
        </section>
        <Inspector />
      </main>
      <div className="p-2.5"><SequenceStrip /></div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line-soft px-4 text-[11px] text-ink-3">
        <Hud />
        <span className="flex-1" />
        <span className="hidden lg:inline">Space play · ← → one frame · ⇧ one second · Esc deselect</span>
      </footer>
    </div>
  );
}
