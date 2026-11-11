import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {dedupe: ["react", "react-dom"]},
  // Pre-bundle at startup so Vite does not re-optimise mid-load and split React into two copies.
  // Do NOT add "remotion" here: it breaks AbsoluteFill.
  // Workspace packages are served from source so a schema change never hits a stale pre-bundle.
  optimizeDeps: {exclude: ["@studio/schema"], include: ["@studio/schema > zod", "@remotion/transitions", "@remotion/transitions/fade", "@remotion/fonts"]},
});
