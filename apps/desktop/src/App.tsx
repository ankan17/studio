import {useEffect} from "react";
import {Dashboard} from "./Dashboard";
import {Editor} from "./Editor";
import {useEditor} from "./editorStore";
import {applyImport} from "./mediaStore";

export function App() {
  const hasProject = useEditor((s) => s.project !== null);
  // The window is closing: save pending edits, then tell main it can go ahead.
  useEffect(() => window.studio.onFlushRequest(() => void useEditor.getState().flush().finally(() => void window.studio.flushDone())), []);
  // End-to-end hook: a drop from Finder gives paths through webUtils, which a script cannot fake, so it passes paths directly.
  useEffect(() => {
    if (!window.studio.isE2E) return;
    (window as unknown as {__e2e: unknown}).__e2e = {
      drop: async (paths: string[]) => {
        const id = useEditor.getState().project!.id;
        const outcome = await window.studio.media.importPaths(id, paths);
        await applyImport(id, outcome);
        return outcome;
      },
      project: () => useEditor.getState().project,
      clearTimeline: () => useEditor.getState().update((p) => void (p.tracks = [])),
    };
  }, []);
  return hasProject ? <Editor /> : <Dashboard />;
}
