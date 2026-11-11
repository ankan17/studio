import {useEffect} from "react";
import {Dashboard} from "./Dashboard";
import {Editor} from "./Editor";
import {locate, type Command} from "@studio/editor-core";
import {useView} from "./edits";
import {history, useEditor} from "./editorStore";
import {timelineMediaStats} from "./timelineMedia";
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
      // Test setup goes through the same commands as the UI.
      clearTimeline: () => {
        const ed = useEditor.getState();
        for (const t of ed.project!.tracks) ed.dispatch({type: "deleteTrack", trackId: t.id});
      },
      patchClip: (id: string, patch: {startFrame?: number; durationInFrames?: number}) => {
        const ed = useEditor.getState();
        const clip = locate(ed.project!, id)!.clip;
        if (patch.durationInFrames !== undefined) ed.dispatch({type: "trimClip", clipId: id, edge: "end", deltaFrames: patch.durationInFrames - clip.durationInFrames});
        if (patch.startFrame !== undefined) ed.dispatch({type: "moveClips", clipIds: [id], deltaFrames: patch.startFrame - clip.startFrame});
      },
      dispatch: (cmd: Command) => useEditor.getState().dispatch(cmd),
      selection: () => useEditor.getState().selection,
      history: () => ({size: history.size, canUndo: history.canUndo, canRedo: history.canRedo}),
      view: () => useView.getState(),
      setView: (v: Partial<ReturnType<typeof useView.getState>>) => useView.setState(v),
      mediaCache: timelineMediaStats,
    };
  }, []);
  return hasProject ? <Editor /> : <Dashboard />;
}
