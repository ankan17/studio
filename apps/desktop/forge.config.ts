import {VitePlugin} from "@electron-forge/plugin-vite";

// Export uses the web renderer inside the app, so no Remotion compositor binaries or bundled browser are packaged.
const config = {
  packagerConfig: {asar: true},
  rebuildConfig: {},
  plugins: [
    new VitePlugin({
      build: [
        {entry: "src/main.ts", config: "vite.main.config.ts", target: "main"},
        {entry: "src/preload.ts", config: "vite.preload.config.ts", target: "preload"},
        {entry: "src/worker-preload.ts", config: "vite.preload.config.ts", target: "preload"},
      ],
      renderer: [{name: "main_window", config: "vite.renderer.config.ts"}],
    }),
  ],
};

export default config;
