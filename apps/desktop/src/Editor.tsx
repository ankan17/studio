import {useEffect, useState} from "react";
import {edits, view} from "./edits";
import {useEditor, type SaveState} from "./editorStore";
import {Back, Check, Warning} from "./icons";
import {Hud} from "./Hud";
import {Inspector} from "./Inspector";
import {MediaPanel} from "./MediaPanel";
import {ensureMedia, handleMediaEvent, useMedia} from "./mediaStore";
import {playback} from "./playback";
import {Stage} from "./Stage";
import {Timeline} from "./Timeline";
import {clearTimelineMedia} from "./timelineMedia";
import {Transport} from "./Transport";

// Saved is a quiet ink tick, not a colour: gold would sit too close to the orange "unsaved" dot.
const SAVE: Record<SaveState, {label: string; dot: string | null}> = {
  saved: {label: "Saved", dot: null},
  dirty: {label: "Unsaved changes", dot: "bg-warn"},
  saving: {label: "Saving…", dot: "bg-warn"},
  error: {label: "Could not save", dot: "bg-danger"},
};

// A slider keeps its arrow keys; every other shortcut still works while it has focus.
const isTyping = (t: EventTarget | null, key: string) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["TEXTAREA", "SELECT"].includes(t.tagName) || (t instanceof HTMLInputElement && (t.type !== "range" || key.startsWith("Arrow") || key === "Home" || key === "End")));

export function Editor() {
  const {project, recovered, saveState, error, dispatch, close, refusal} = useEditor();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);

  // Worker events and the open-time check (queue missing proxies, find missing files) live as long as the project is open.
  useEffect(() => {
    if (!projectId) return;
    useMedia.getState().reset();
    playback.reset();
    view.reset();
    clearTimelineMedia();
    const off = window.studio.media.onEvent(handleMediaEvent);
    void ensureMedia(projectId, useEditor.getState().project?.assets ?? []);
    return () => {
      off();
      void window.studio.media.cancel(projectId); // leaving the project stops its queue; reopening resumes it
    };
  }, [projectId]);

  // A refused edit is explained in the status bar for a few seconds.
  useEffect(() => {
    if (!refusal) return;
    const t = setTimeout(() => useEditor.setState({refusal: null}), 4000);
    return () => clearTimeout(t);
  }, [refusal]);

  // Keyboard: the same functions the buttons and menus call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In the project name field, Cmd+Z undoes the rename through the history (the field's own undo fights React).
      // The same for a title's text (any field marked data-history-undo).
      const nameField = e.target instanceof HTMLElement && e.target.matches('input[aria-label="Project name"], [data-history-undo]');
      if (nameField && (e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        return void (e.shiftKey ? useEditor.getState().redo() : useEditor.getState().undo());
      }
      if (isTyping(e.target, e.key) || e.altKey) return;
      const fps = useEditor.getState().project?.fps ?? 30;
      const hit = (fn: () => unknown) => (e.preventDefault(), void fn());
      const mod = e.metaKey || e.ctrlKey;
      const ed = useEditor.getState();
      if (mod) {
        if ((e.code === "KeyZ" || e.code === "KeyY") && document.body.dataset.dragging) return hit(() => {}); // not mid-drag
        if (e.code === "KeyZ") hit(e.shiftKey ? ed.redo : ed.undo);
        else if (e.code === "KeyY") hit(ed.redo);
        else if (e.code === "KeyD") hit(edits.duplicate);
        else if (e.code === "KeyA") hit(edits.selectAll);
        else if (e.code === "KeyB") hit(edits.split);
        else if (e.code === "Equal") hit(() => view.zoomBy(1.5));
        else if (e.code === "Minus") hit(() => view.zoomBy(1 / 1.5));
        return;
      }
      if (e.code === "Space") hit(playback.toggle);
      else if (e.code === "ArrowLeft") hit(() => playback.step(e.shiftKey ? -fps : -1));
      else if (e.code === "ArrowRight") hit(() => playback.step(e.shiftKey ? fps : 1));
      else if (e.code === "Home") hit(playback.toStart);
      else if (e.code === "End") hit(playback.toEnd);
      else if (e.code === "Escape") hit(() => ed.select([]));
      else if (e.code === "KeyS") hit(edits.split);
      else if (e.code === "Delete" || e.code === "Backspace") hit(edits.delete);
      else if (e.code === "KeyN") hit(view.toggleSnapping);
      else if (e.code === "KeyM") hit(edits.addMarker);
      else if (e.code === "KeyT") hit(edits.addText);
      else if (e.code === "KeyZ" && e.shiftKey) hit(view.fit);
      else if (e.code === "Equal") hit(() => view.zoomBy(1.5));
      else if (e.code === "Minus") hit(() => view.zoomBy(1 / 1.5));
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
          onChange={(e) => dispatch({type: "setProject", patch: {name: e.target.value}}, {coalesce: "name", label: "Rename"})}
          onBlur={(e) => !e.target.value.trim() && dispatch({type: "setProject", patch: {name: "Untitled"}}, {coalesce: "name", label: "Rename"})}
        />
        <span className="no-drag flex items-center gap-1.5 text-caption text-ink-2" title={error ?? undefined} data-testid="save-state">
          {save.dot ? <span className={`h-1.5 w-1.5 rounded-full ${save.dot}`} /> : <span className="-mx-0.5 text-ink-3"><Check size={12} /></span>}
          {save.label}
        </span>
        <div className="flex-1" />
        <label className="no-drag flex items-center gap-2 text-caption text-ink-2" title="Colour behind clips that do not fill the frame">
          Background
          <input type="color" className="h-5 w-5 cursor-pointer appearance-none rounded-full border border-line bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0" value={project.backgroundColor} onChange={(e) => dispatch({type: "setProject", patch: {backgroundColor: e.target.value}}, {coalesce: "background", label: "Background colour"})} />
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
      <div className="p-2.5"><Timeline /></div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line-soft px-4 text-[11px] text-ink-3">
        <Hud />
        <span className="flex-1" />
        {refusal ? (
          <span className="flex items-center gap-1.5 text-warn" role="status" data-testid="refusal"><Warning size={12} /> {refusal}</span>
        ) : (
          <span className="hidden lg:inline">Space play · S split · ⌫ delete · ⌘Z undo · ⌘= zoom · right-click for more</span>
        )}
      </footer>
    </div>
  );
}
