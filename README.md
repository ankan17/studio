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

## Carry-over from the spike (`carry-over/`)
- `media-protocol.ts`: `media://` protocol with Range support and path allow-list. Before use, harden it (see below).
- `memory-sampler.ts`: `app.getAppMetrics()` sampler with CSV log.
- `hud-snippet.tsx.txt`: the overlay HUD markup from the spike UI.
- `summarize-run.py`: summarises a memory CSV (settled baseline, peak, per-process growth).
- `pnpm-workspace.yaml`: the `@electron/node-gyp` override that makes `pnpm install` work with the template. Do not set `blockExoticSubdeps: false`.

## Security lessons to apply in M1 (from the spike review)
- Main picks output paths via a save dialog; the renderer never supplies a path.
- Check sender origin/frame URL on every IPC handler, add `will-navigate` and window-open guards, enable `sandbox: true`.
- Resolve symlinks (`realpath`) in the `media://` allow-list; return 416 for bad `bytes=-N` ranges.
- Remove autorun env vars and wide `localhost:*` CSP from production builds.

## Setup notes
- Pin all `remotion` and `@remotion/*` to one exact version (spike used 4.0.542) and `mediabunny` to 1.64.0.
- Launch dev with `npx electron-forge start`; Forge exits when stdin closes, so keep it open when scripting.
- Keep `backgroundThrottling: false` on editor and worker windows.
- Do not add `remotion` to Vite `optimizeDeps.include`; do pre-include `@remotion/transitions` and `@remotion/fonts`, and set `resolve.dedupe` for react.
- Fonts: Noto Sans Bengali and Bebas Neue (SIL OFL) are in the spike repo `spike/fonts/`.
- Memory bars apply to the 8GB Mac: editor tab under 600MB, total under 1.2GB, export peak under 1.5GB.
