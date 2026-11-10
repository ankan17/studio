# End-of-spike decisions

Editor Starter: decided Nov 10 2026, not bought (no expenses). We build from the Electron template.

All three gates below were re-measured on the 8GB target on Nov 10 2026 and hold (earlier figures were from a 24GB dev Mac). Caveats: other apps were open during the 8GB run, and swap was flat at 0.8GB used, so swap growth is not a strong signal.

| Gate | Decision | Decided by |
|------|----------|------------|
| Web renderer or Node renderer | Web renderer (`renderMediaOnWeb`), confirmed on 8GB. 2-min 1080p export in 41.1s (0.34x realtime), peak 1.11GB total (bar 1.5GB), clean cancel, audio in sync by ear; style output matches stills (exp5, PSNR 40 to 42 dB). Margin to the memory bar is thin: watch it as composition complexity grows. Node renderer stays the fallback if a heavier project exceeds 1.5GB or 4x realtime. (24GB: 24.7s, 1.18GB.) | exp3, exp5 |
| Remotion DOM or canvas compositor | Remotion DOM compositor, confirmed on 8GB. Three video layers + text at 29.9fps each, editor tab 396MB peak (bar 600MB), 741MB total (bar 1.2GB). One run only. Bengali shaping, shadows, blur and cross-fade all render correctly. | exp2, exp5 |
| Normalise at import or not | No separate normalise step for colour; the proxy step is the normalisation (HDR becomes SDR consistently in preview and export, about 2 to 8 luma levels lighter than Apple's rendering on 8GB; export matches proxy within 0.4; export and original looked the same in QuickTime by eye). Rotation handled; portrait plays upright in the Player. Revisit only if that lift is judged too visible; then tune at proxy creation. Portrait proxies need a portrait-native size. | exp4 |

Other findings that affect scope:
- `@remotion/transitions` `dissolve()` needs Chrome 149+; Electron here has Chrome 148. V1 uses non-shader transitions (fade, slide, wipe).
- Portrait proxies are pillarboxed in a 1280x720 frame; consider a portrait-native proxy size.
- `<Video>` from `@remotion/media` needs an explicit width and height (or 100% of a sized parent). Without one, a portrait clip is cropped to a zoomed strip in a landscape composition because `objectFit` has no box to fit into. Fixed in `remotion/SpikeVideo.tsx`.
- exp6 main-process growth was 51MB on the 96s clip (bar 50MB) and 35MB on the others, measured from the first sample; re-measure with a settled baseline before relying on it.
- Web-renderer export leaves one extra utility process after the render window closes (untraced).

# Experiment 7: reference review (reading only, Nov 10 2026)

Done by fetching public pages; summaries were written by helper agents and only the pages named were read. Treat as leads to verify, not as spec.

## Remotion Editor Starter (paid; public docs only)
The public landing page (remotion.dev/docs/editor-starter) says only: template with timeline, interactive canvas, font picker, asset uploads; 80+ feature flags; sold under a separate Editor Starter licence. Sub-pages (FAQ etc.) could not be reached because the docs sidebar is client-rendered. Nothing about architecture, undo, proxies or performance is public. Action: nothing to learn here without buying; if wanted, supply exact FAQ URLs from a browser.

## OpenChatCut (github.com/0xsline/OpenChatCut, AGPL-3.0: approach only, copy no code)
Read `desktop/main.ts`, `preload.ts`, `local-media-bridge.ts`, `static-files.ts`, `remotion/render.mjs` and the README.
- Electron: contextIsolation on, nodeIntegration off, one `contextBridge` object, every IPC handler checks the sender origin. `backgroundThrottling: false` (same finding as ours). Local file paths come via `webUtils.getPathForFile`, main requires absolute paths.
- Media is served from an embedded loopback HTTP server with Range support, with Host-header checks against DNS rebinding. Ours is a custom `media://` protocol; consider similar host/path validation (path traversal) in our handler.
- Export uses the Node renderer (`@remotion/renderer`: openBrowser, selectComposition, renderMedia), tries hardware H.264 first with software fallback, cancels via AbortSignal and closing the browser.
- Data model: `TimelineState` with items, edits as immutable undoable commands.
- Pitfalls they note: static ffmpeg lacks libfdk_aac (Remotion AAC encode fails, encoder delay needs compensation), asar-packed binaries cannot be spawned, plain-HTTP origins disable WebCodecs/Web Crypto, macOS builds unsigned.
- Unverified: Player usage for preview (README summary only), proxy strategy (not described).

## omniclip (github.com/omni-media/omniclip, MIT: can borrow with attribution)
Read the README, `s/` tree, `context/state.ts`, `tools/demuxer.ts`, `utils/actionize.ts`.
- State is split into historical (tracks, effects, filters, animations, transitions: undoable) and non-historical (playback, timecode, zoom, export status). Worth copying as a pattern for our project state.
- Demuxer reads a range from 1s before to 1s after the request to avoid keyframe stalls and applies backpressure from the encoder queue (limit 500). Useful for our export/proxy workers.
- Its demuxer loads wasm from a CDN; we must self-host anything like that (our CSP blocks the network).
- Not read: compositor (Pixi), export worker, audio, undo code, memory handling. Version 2.0 is in development, so code may change.

## Take-aways for the plan
1. Adopt the historical vs non-historical state split for undo.
2. Add path and host validation to the `media://` handler, and review IPC handlers for sender checks (we have `assertTrustedSender`).
3. AAC encoding: our web-renderer export passed with AAC, but check encoder-delay sync by ear.
4. Nothing found that contradicts the web-renderer decision; OpenChatCut chose the Node renderer for server-side use.
