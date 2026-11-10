import {useEffect} from "react";
import {Dashboard} from "./Dashboard";
import {Editor} from "./Editor";
import {useEditor} from "./editorStore";

export function App() {
  const hasProject = useEditor((s) => s.project !== null);
  // The window is closing: save pending edits, then tell main it can go ahead.
  useEffect(() => window.studio.onFlushRequest(() => void useEditor.getState().flush().finally(() => void window.studio.flushDone())), []);
  return hasProject ? <Editor /> : <Dashboard />;
}
