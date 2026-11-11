import {useEffect, useState} from "react";
import {useEditor, type SaveState} from "./editorStore";
import {Back} from "./icons";
import {Hud} from "./Hud";
import {MediaPanel} from "./MediaPanel";
import {ensureMedia, handleMediaEvent, useMedia} from "./mediaStore";
import {playback} from "./playback";
import {SequenceStrip} from "./SequenceStrip";
import {Stage} from "./Stage";
import {Transport} from "./Transport";

const SAVE: Record<SaveState, {label: string; dot: string}> = {
  saved: {label: "Saved", dot: "bg-audio"},
  dirty: {label: "Unsaved", dot: "bg-warn"},
  saving: {label: "Saving…", dot: "bg-warn animate-pulse"},
  error: {label: "Save failed", dot: "bg-danger"},
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) return null;
  const save = SAVE[saveState];
  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-[46px] shrink-0 items-center gap-3 border-b border-line pr-4" style={{paddingLeft: 84}}>
        <button className="btn btn-ghost no-drag -ml-1 !px-2" onClick={() => void close()} title="Back to projects"><Back size={14} /> Projects</button>
        <span className="h-4 w-px bg-line-strong" />
        <input
          className="no-drag h-7 min-w-0 max-w-[320px] rounded-md border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition hover:border-line-strong focus:border-accent focus:bg-bg"
          value={project.name}
          aria-label="Project name"
          onChange={(e) => update((p) => void (p.name = e.target.value))}
          onBlur={(e) => !e.target.value.trim() && update((p) => void (p.name = "Untitled"))}
        />
        <span className="no-drag flex items-center gap-1.5 text-xs text-dim" title={error ?? undefined} data-testid="save-state">
          <span className={`h-1.5 w-1.5 rounded-full ${save.dot}`} />
          {save.label}
        </span>
        <div className="flex-1" />
        <label className="no-drag flex items-center gap-2 text-xs text-dim" title="Canvas background">
          Background
          <input type="color" className="h-5 w-5 cursor-pointer appearance-none rounded-full border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0" value={project.backgroundColor} onChange={(e) => update((p) => void (p.backgroundColor = e.target.value))} />
        </label>
      </header>
      {recovered && <div className="mx-3 mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">This project was restored from a recovery copy because its main file was damaged.</div>}
      <main className="grid min-h-0 flex-1 gap-3 p-3 pb-0" style={{gridTemplateColumns: "400px minmax(0, 1fr)"}}>
        <MediaPanel selectedId={selected} onSelect={setSelected} />
        <section className="panel flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col p-4 pb-0">
            <Stage />
          </div>
          <Transport />
        </section>
      </main>
      <div className="pt-3"><SequenceStrip /></div>
      <footer className="flex h-6 shrink-0 items-center border-t border-line px-4"><Hud /></footer>
    </div>
  );
}
