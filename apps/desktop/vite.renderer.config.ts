import react from "@vitejs/plugin-react";
import {defineConfig, type Plugin} from "vite";

// Only the dev server needs localhost in the CSP. A packaged build drops it, so nothing in the page can talk to a local port.
const productionCsp: Plugin = {
  name: "production-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace(" http://localhost:* ws://localhost:*", ""),
};

export default defineConfig({
  plugins: [react(), productionCsp],
  resolve: {dedupe: ["react", "react-dom"]},
  // Pre-bundle at startup so Vite does not re-optimise mid-load and split React into two copies.
  // Do NOT add "remotion" here: it breaks AbsoluteFill.
  // Workspace packages are served from source so a schema change never hits a stale pre-bundle.
  optimizeDeps: {exclude: ["@studio/schema", "@studio/editor-core"], include: ["@studio/schema > zod", "@studio/editor-core > immer", "@remotion/transitions", "@remotion/transitions/fade", "@remotion/fonts", "@remotion/web-renderer"]},
});
