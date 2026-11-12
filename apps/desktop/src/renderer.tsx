import {createRoot} from "react-dom/client";
import "./index.css";

// Decoded-frame cache for @remotion/media. The plan said 200MB, but Remotion's minimum is 240MB: a smaller value makes
// the WebCodecs player throw and silently fall back to a native <video> element. Read on first use.
(window as unknown as {remotion_mediaCacheSizeInBytes: number}).remotion_mediaCacheSizeInBytes = 240 * 1024 * 1024;

// The hidden media worker window loads this same bundle with ?worker=media, and the export render window with
// ?worker=render. Neither mounts any UI.
if (new URLSearchParams(location.search).get("worker") === "media") {
  void import("./media-worker").then((m) => m.startMediaWorker());
} else if (new URLSearchParams(location.search).get("worker") === "render") {
  void import("./render-worker").then((m) => m.startRenderWindow());
} else {
  const container = document.getElementById("react-root");
  if (container) void Promise.all([import("./App"), import("./engine/fonts")]).then(([{App}, {loadBundledFonts}]) => {
    void loadBundledFonts();
    createRoot(container).render(<App />);
  });
}
