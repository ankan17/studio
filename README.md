# Studio

Desktop video editor built on Remotion and Electron, for editing on an 8GB Apple Silicon Mac. The plan lives in the
"Studio Video Editor: Project Plan" doc (Claude Docs). This repo starts at M1 (desktop foundation), after the Phase 0 spike.

The spike repo is `ankan17/studio-spike`; its findings are copied into `docs/`.

## Decisions from the spike (confirmed on the 8GB target, Nov 10 2026)
- Export with the web renderer (`renderMediaOnWeb`) in a hidden window, streamed to disk over IPC. Node renderer is the fallback.
- Preview with the Remotion DOM compositor (Player + `@remotion/media`) on 720p proxies, not a canvas compositor.
- No separate colour-normalise step: the proxy step converts HDR to SDR. Send HEVC 10-bit and HDR sources through the proxy queue even at 1080p30.
- Transitions: non-shader only (fade, slide, wipe); `dissolve()` needs Chrome 149+, Electron here ships 148.
- `<Video>` from `@remotion/media` needs an explicit width and height, or portrait clips are cropped.
- Editor Starter is not bought; we build from the Remotion Electron template. Unsigned builds for V1 (confirm before M7).

Full figures and caveats: `docs/spike-results.md`, `docs/spike-decisions.md`.

## Layout
- `apps/desktop`: Electron Forge + Vite + React + Tailwind app. `src/main.ts` (window, IPC, security settings), `src/preload.ts` (typed `window.studio` API from `src/ipc.ts`), `src/media-protocol.ts` (hardened `media://` with Range), `src/memory-sampler.ts` and `src/Hud.tsx` (memory HUD), `src/editorStore.ts` (zustand + immer, 800ms debounced autosave, flush on close and on window close), `src/Dashboard.tsx` (recent projects, new project with format and fps picker, rename, duplicate, delete, thumbnails), `src/Editor.tsx` (project shell with save status, a video preview and a set-thumbnail button). Every IPC request is Zod-validated in main (`src/ipc.ts`).
- `packages/schema`: Zod project schema v1 (`@studio/schema`): integer frames for the timeline, integer microseconds for source offsets, assets manifest, tracks, clips (transform, crop, fit, volume, fades, text), markers, format presets, a migration scaffold (`migrateProject`) and `convertProjectFps` (fps change on duplicate converts positions through time).
- `packages/project-store`: Node-only project folder manager (`@studio/project-store`). Layout under the app data folder `projects/` (override with `STUDIO_PROJECTS_DIR`): `index.json` (rebuildable mirror), `<uuid>/project.json` (source of truth), `project.json.prev`, `recovery/<ms>.json` (snapshots, newest 10), `assets/`, `cache/`, `thumbnail.jpg`. Saves are atomic (temp file, fsync, rename), all mutations are serialised, ids must be UUIDs, delete moves to the Trash. Opening falls back to the newest valid snapshot, then `.prev`, if `project.json` is damaged.
- `scripts/summarize-run.py`: summarises a memory CSV (settled baseline, peak, per-process growth).

## Run
```
pnpm install            # needs the @electron/node-gyp override in pnpm-workspace.yaml; the esbuild ignored-builds warning is harmless
pnpm dev                # electron-forge start in apps/desktop; keep stdin open when scripting: npx electron-forge start < <(sleep 1700)
pnpm typecheck
pnpm lint
pnpm test                # schema tests, store tests, and a SIGKILL-mid-save crash test
```

## Security lessons (from the spike review) and where they are applied
- Main picks paths via native dialogs; the renderer never supplies a path (`openMedia` does this; do the same for export).
- Done in `main.ts`: `assertTrusted` checks the top frame on every handler, `will-navigate` and window-open guards, `sandbox: true`, permission requests denied. Keep calling `assertTrusted` in every new handler.
- Done in `media-protocol.ts`: realpath-based allow-list of folders added by main, 416 for bad ranges.
- Still to do: tighten the CSP for production builds (`localhost:*` is only for the dev server).

## Setup notes
- Pin all `remotion` and `@remotion/*` to one exact version (spike used 4.0.542) and `mediabunny` to 1.64.0.
- Launch dev with `npx electron-forge start`; Forge exits when stdin closes, so keep it open when scripting.
- Keep `backgroundThrottling: false` on editor and worker windows.
- Do not add `remotion` to Vite `optimizeDeps.include`; do pre-include `@remotion/transitions` and `@remotion/fonts`, and set `resolve.dedupe` for react.
- Fonts: Noto Sans Bengali and Bebas Neue (SIL OFL) are in the spike repo `spike/fonts/`.
- Memory bars apply to the 8GB Mac: editor tab under 600MB, total under 1.2GB, export peak under 1.5GB.

## M1 status
Done: monorepo, Forge + Vite + sandboxed renderer, Zod-validated typed IPC, hardened `media://`, schema v1 with validators and migration scaffold, project folder manager, atomic save, recovery snapshots, debounced autosave, dashboard, memory HUD.
M1 exit check: the crash test SIGKILLs a writer at random moments 12 times and the project always reopens; an end-to-end run in the real app covered create, edit, autosave, reopen, duplicate and rejected bad input.
Not covered yet: dashboard thumbnails are only set manually (button in the editor) until there are clips to take a frame from (M2).
