import {VitePlugin} from "@electron-forge/plugin-vite";

// Export uses the web renderer inside the app, so no Remotion compositor binaries or bundled browser are packaged.
const config = {
  packagerConfig: {
    asar: true,
    name: "Studio",
    appBundleId: "com.ankan17.studio",
    appCategoryType: "public.app-category.video",
    icon: "assets/icon", // assets/icon.icns, drawn by assets/make-icon.py
    // V1 is not signed with a Developer ID and not notarised (no paid Apple Developer account). scripts/make-dmg.sh gives the
    // app an ad-hoc signature, which Apple Silicon needs to run it; the first launch is right-click, Open.
  },
  rebuildConfig: {},
  plugins: [
    new VitePlugin({
      build: [
        {entry: "src/main.ts", config: "vite.main.config.ts", target: "main"},
        {entry: "src/preload.ts", config: "vite.preload.config.ts", target: "preload"},
        {entry: "src/worker-preload.ts", config: "vite.preload.config.ts", target: "preload"},
        {entry: "src/render-preload.ts", config: "vite.preload.config.ts", target: "preload"},
      ],
      renderer: [{name: "main_window", config: "vite.renderer.config.ts"}],
    }),
  ],
};

export default config;
