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
- `apps/desktop`: Electron Forge + Vite + React + Tailwind app. `src/main.ts` (window, IPC, security settings), `src/preload.ts` (typed `window.studio` API from `src/ipc.ts`), `src/media-protocol.ts` (hardened `media://` with Range), `src/memory-sampler.ts` and `src/Hud.tsx` (memory HUD), `src/App.tsx` (open a video, preview it in the Remotion Player).
- `packages/schema`: Zod project schema (`@studio/schema`): integer frames for the timeline, integer microseconds for source offsets, assets manifest, transitions as a property of the gap between clips.
- `scripts/summarize-run.py`: summarises a memory CSV (settled baseline, peak, per-process growth).

## Run
```
pnpm install            # needs the @electron/node-gyp override in pnpm-workspace.yaml; the esbuild ignored-builds warning is harmless
pnpm dev                # electron-forge start in apps/desktop; keep stdin open when scripting: npx electron-forge start < <(sleep 1700)
pnpm typecheck
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
