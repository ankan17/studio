# Studio Video Editor: Project Plan

> Exported from the Claude Docs plan "Studio Video Editor: Project Plan" (https://claude.ai/artifact/PXtzMhasq6GKDU3oH1MBut) on 2026-11-12. The live doc is the source of truth; diagrams exist only there.

Nov 10, 2026 · @Ankan

## Summary

Studio is a local-first, CapCut-style desktop video editor built on Remotion, targeted at two users first: a YouTube vlog channel and a saree business. V1 is not an agentic editor. Every edit is made by hand on a timeline, in an inspector or on the preview canvas. No chat, no AI agent, no generated video in V1. Automatic reels (Phase 2, `docs/phase2-plan.md`) and a chat editor (Phase 3, `docs/phase3-plan.md`) come after V1, as an optional layer on the user's own API key.

The command-based editing core keeps the door open. Each timeline operation is a typed command with an inverse, which is exactly the shape an agent would call as a tool. If an agent layer is wanted later, it is an adapter over the command bus, not a rewrite. Auto captions are the one AI-adjacent feature creators will ask for; the schema reserves a caption track type so it can land in V1.5 without a migration.

The original spec stands on scope, project model and milestones. The plan below changes five technical decisions, all driven by the low-memory requirement:

| Area | Original spec | This plan | Why |
| --- | --- | --- | --- |
| Export | `@remotion/renderer` in the main process with headless Chrome | `@remotion/web-renderer` in a hidden Electron window | One Chromium, no 150MB headless shell, no bundle step, streamed output |
| Media components | Mixed: Html5Video in preview, FFmpeg-backed OffthreadVideo in render | `<Video>` and `<Audio>` from `@remotion/media` everywhere | Frame-accurate in both paths and the only tags the web renderer supports |
| Media processing | FFmpeg and FFprobe binaries | Mediabunny in-process (metadata, thumbnails, proxies) | No bundled binary, hardware WebCodecs decode, byte-range reads |
| Project index | SQLite with Drizzle | JSON index file in V1, SQLite deferred to M8 | Index only, no native module to rebuild for Electron |
| Proxies | Optional setting | Default for any source above 1080p | Decoded frames are the memory budget |

Electron stays. The shell is not where memory goes; decoded frames and the compositor are. Tauri and a PixiJS canvas compositor remain fallbacks with explicit gates in the spike section.

## Scope

V1 is done when one person can take 10 phone-recorded clips, cut a 2 to 3 minute vlog with music and titles, and export a 1080p MP4 without opening another editor. Everything in V1 serves that test.

**In V1**

- Projects: create, open, duplicate, rename, delete, autosave, crash recovery, self-contained project folders
- Media: import video, image and audio by copy, metadata, thumbnails, filmstrips, waveforms, proxies
- Timeline: multiple video and audio tracks, move, trim, split, duplicate, delete, snapping, zoom, multi-select, undo and redo
- Clips: speed 0.5x to 2x, crop, scale, position, rotation, opacity, flip, fit mode, volume, mute, fade in and out
- Text: content, font, size, colour, alignment, background, stroke, shadow, a small set of entrance and exit presets
- Transitions: cut, fade, dissolve between adjacent clips (spike 5: the shader dissolve needs Chrome 149 and Electron has 148, so V1 uses the non-shader cross-fade and true dissolve waits for a newer Electron)
- Preview: Remotion Player, play, seek, frame step, canvas drag to position, aspect ratios 16:9, 9:16, 4:5, 1:1
- Export: MP4 H.264 with AAC at 720p or 1080p, 24, 25, 30 or 60 fps, progress and cancel

**Moved out of V1** (Nov 14, 2026, with the Phase 2 plan, `docs/phase2-plan.md`, which decides where it lands)

- Business Studio (M8): product record, brand kit, three promotional templates with auto-filled title, price and brand

**Out of V1, schema-ready**

- Auto captions with local whisper.cpp (caption track type reserved)
- Keyframe animation (transform fields are already per clip, keyframes attach later)
- Link-instead-of-copy media import
- Windows build (code stays cross-platform, only macOS is tested and signed)

**Moved to Phase 2** (Nov 14, 2026)

- Colour grading with LUTs (`docs/phase2-plan.md`)

**Out, not planned**

- Multicam, green screen, AI-generated video, collaboration, cloud rendering, direct publishing, mobile

## Architecture

Three processes, one Chromium. The main process owns files and IPC, the editor window owns editing and preview, and a hidden render window owns export so the editor never stalls and a cancel is a window close.

*(Diagram in the live doc: process model, main process, editor window, hidden render window.)*

The editor sends a validated project snapshot to the main process, which opens the render window with it. Both windows read media through the same byte-range protocol, so preview and export decode the same bytes.

**Stack**

| Layer | Choice | Notes |
| --- | --- | --- |
| Shell | Electron with Electron Forge and Vite | Context isolation on, Node integration off, typed preload API |
| UI | React, TypeScript, Tailwind, shadcn/ui |  |
| State | Zustand with immer patches | Undo stores inverse patches, not snapshots |
| Preview | `@remotion/player` with `<Video>` and `<Audio>` from `@remotion/media` | Frame-accurate, WebCodecs decode |
| Export | `@remotion/web-renderer`, `renderMediaOnWeb()` | H.264 in MP4 with AAC, streamed via `outputWritable` |
| Media processing | Mediabunny | Metadata, frame extraction, proxy transcode, waveform peaks |
| Transitions | `@remotion/transitions` | Fade and dissolve as TransitionSeries |
| Fonts | `@remotion/fonts` loading bundled files | Includes Noto Sans Bengali, no network at render time |
| Schema | Zod with `schemaVersion` migrations | Shared by editor, renderer and templates |
| Timeline input | Raw pointer events with pointer capture | dnd-kit only for dragging media from the panel |
| Project index | JSON file in the app data folder | SQLite deferred until the product catalogue needs queries |
| Tests | Vitest for editor-core, Playwright for Electron, golden frames via `renderStillOnWeb()` |  |

All Remotion packages are pinned to one version. Mediabunny is pinned to the version Remotion depends on.

**Packages** in a pnpm workspace with Turborepo:

- `apps/desktop`: Electron main, preload, IPC handlers, React app
- `packages/project-schema`: Zod types, validators, migrations
- `packages/editor-core`: commands, inverse patches, history, timeline maths, selectors. Pure TypeScript, no React
- `packages/remotion-engine`: the one generic composition, element renderers, transitions, audio, export entry
- `packages/media-core`: import, metadata, thumbnails, waveforms, proxies on Mediabunny
- `packages/templates`: creator and business templates as composition presets with a Zod props schema
- `packages/shared`: constants and utilities

The split matters because `editor-core` and `project-schema` never import Electron or React. A later web build, a CLI render or an agent adapter reuses them unchanged.

## Project model

The project file is the source of truth and must be self-contained. These decisions are fixed before milestone 1 because every later package depends on them.

| Decision | Rule |
| --- | --- |
| Timeline units | Integer project frames for every clip start and duration |
| Source units | Integer microseconds for `sourceStartUs` and `sourceDurationUs`, independent of source fps |
| Speed | `sourceDurationUs = durationInFrames / fps * speed * 1e6`. A speed change alters clip length and ripples the clips after it on the same track |
| Split | Both halves keep the original asset, speed and transforms. Source offsets derive from the split frame |
| Transitions | A property of the gap between two adjacent clips on one track, with `durationInFrames`. It consumes handle frames from both clips, so both need untrimmed source on that side |
| Assets | A manifest inside project.json: id, relative path, type, duration, fps, width, height, rotation, sha256, proxy path. SQLite or the JSON index only mirrors it |
| Track types | video, audio, text, image, caption (reserved) |
| Track flags | locked, visible, muted, order |
| Clip fields | transform (x, y, scale, rotation, opacity, flipH), crop rect, fit (cover or contain), volume, muted, fadeInFrames, fadeOutFrames |
| Text fields | content, fontFamily, fontSize, colour, alignment, background, stroke, shadow, maxWidth, lineHeight, enterPreset, exitPreset |
| Audio from video | An audio clip may reference a video asset. Detach audio creates one and mutes the video clip |
| Project settings | width, height, fps (24, 25, 30, 60), backgroundColor. Changing fps on duplicate converts frame positions through microseconds |
| Fonts | Referenced by family name. The app resolves to bundled files and warns on a missing family |
| Markers | Frame plus label, for the timeline ruler |
| Versioning | `schemaVersion` integer with a forward migration per bump. Loading never mutates a file until the user saves |

**Persistence**

1. Serialise and validate the project with Zod.
2. Write `project.json.tmp`, flush, rename over `project.json`.
3. Copy the previous file to `recovery/<timestamp>.json`, keeping the last 20.
4. Update the project index with name, path, thumbnail and `updatedAt`.

Autosave runs 2 seconds after the last command and immediately when a drag, trim or export starts. On launch, a `project.json` that fails validation falls back to the newest valid recovery snapshot and tells the user.

## Memory and performance budget

The budget is measured on the 8GB Apple Silicon Mac the vlogs are edited on with the sum of all Electron processes from `app.getAppMetrics()`. A milestone does not close while its scenario is over budget, or while swap grows during it.

| Scenario | Budget | Measured from |
| --- | --- | --- |
| Dashboard open, no project | 250MB | M1 |
| Project open, 10 clips of 4K phone footage imported with proxies | 900MB | M2 |
| Playback with three video layers, one text layer, music | 1.2GB, steady 30fps | M3 |
| Export of a 5-minute 1080p30 video | 1.5GB peak, editor usable | M6 |
| Idle after export | Back to the open-project figure within 30 seconds | M6 |

**Levers, each tied to a milestone**

- Proxies by default for any source above 1920x1080 or above 30fps, at 720p H.264 constant frame rate. The export reads originals. (M2)
- Decoded frame cache capped with `mediaCacheSizeInBytes` per window, around 240MB for the editor (Remotion's minimum; a lower value makes the player fall back to a native video tag) and 300MB for the render window. (M3, M6)
- Only clips within 2 seconds of the playhead are mounted, using Sequence premount. Everything else is unmounted, not hidden. (M3)
- Filmstrip thumbnails as JPEG sprite strips on disk, loaded per visible timeline viewport and evicted on scroll. (M2, M4)
- Waveforms as 8-bit peak files on disk, one sample per 10ms, drawn on canvas. (M2)
- Undo history as inverse immer patches, coalesced per gesture, capped at 200 entries. (M5)
- Timeline rows and clips virtualised. React never renders a clip outside the viewport. (M4)
- Export streams to disk through `outputWritable`. The MP4 is never assembled in memory. (M6)
- Render window destroyed after every export, so decoder and encoder memory is returned to the OS. (M6)
- Dev-only memory HUD showing per-process RSS, mounted media elements and cache fill, built in M1 and kept until release.

Memory from decoded video dominates every figure above. One decoded 4K frame is 33MB and one 720p frame 2.7MB, which is why proxies are a default and not a setting.

Measured in the spike on the 8GB Mac (Nov 10): three-layer playback used 396MB in the editor window and 741MB in total; the 2-minute 1080p web export peaked at 1.11GB; main-process growth while making proxies was 35 to 51MB, so one clip missed the 50MB bar by 1MB. Other apps were open during these runs.

## Phase 0: spike

The spike settles the three decisions that would otherwise force a rewrite: whether the web renderer is enough, whether Remotion's DOM preview is fast enough, and whether phone footage needs normalising at import. It is one throwaway repo built from the official Remotion Electron template. Status Nov 10: all seven experiments were rerun on the 8GB Mac, and all three decisions hold there: the web renderer, the Remotion DOM compositor and no separate normalise step (the proxy step already converts HDR to SDR). Details are in the Phase 0 implementation tab.

| # | Experiment | Pass | Fail action |
| --- | --- | --- | --- |
| 1 | Serve a local file through a custom protocol with Range support and play it in `<Video>` from `@remotion/media` inside the Player | Seeks are frame-accurate, no full-file read | Blocking, fix before anything else |
| 2 | Play three 720p proxy layers plus a text layer with music in the Player | Steady 30fps, editor window under 600MB, no swap growth | Switch to the PixiJS canvas compositor before M4 |
| 3 | Render a 2-minute 1080p30 composition with `renderMediaOnWeb()` in a hidden window, streamed to disk | Under 1.5GB peak, under 4x realtime, editor responsive | Fall back to `@remotion/renderer` with concurrency 1 for M6 |
| 4 | Feed iPhone HEVC 60fps HDR clips to experiments 2 and 3 | Decodes in preview and export, colours not washed out | Import normalisation to H.264 SDR becomes mandatory in M2 |
| 5 | Bengali title with Noto Sans Bengali loaded through `@remotion/fonts`, a dissolve, a box-shadow, a blur filter, in the web renderer | Export matches preview pixel for pixel | Remove the unsupported style from the text feature set |
| 6 | Transcode a 4K clip to a 720p proxy with Mediabunny, extract 60 thumbnails, compute peaks | Proxy faster than realtime, main process memory flat | Keep an FFmpeg sidecar for proxies only |
| 7 | Read Editor Starter's public docs, OpenChatCut and omniclip for their approach. No purchase | Approach notes recorded for M3 and M4 | None, this is a decision not a test |

Each experiment records peak RSS per process, wall time and a short note in the repo's `spike/RESULTS.md`. The milestone plan assumes 1 to 6 pass. Where one fails, its fail action is already in the plan as a conditional task.

## Milestones

The milestones run in order from the spike to Business Studio, assuming one full-time engineer. The order and the gates are the commitment.

Order of work:

1. Phase 0 spike
2. M1 Desktop foundation
3. M2 Media import
4. M3 Preview engine
5. Gate 1: vertical slice
6. M4 Timeline
7. M5 Editing features
8. M6 Export
9. Gate 2: real vlog exported
10. M7 Reliability and release
11. V1 creator release, version 1.0.0
12. M8 Business Studio (moved after V1; see `docs/phase2-plan.md`)

Gate 1 is the first vertical slice from the original spec: create, import, preview, save, reopen. Gate 2 is the acceptance test run by the actual user on their own footage. Nothing after a gate starts until it passes.

### M1 Desktop foundation

- [x] Monorepo with pnpm, Turborepo, shared tsconfig and lint
- [x] Electron Forge with Vite, context isolation on, typed preload API with Zod-validated IPC
- [x] `media://` protocol with Range support, carried over from spike 1
- [x] `project-schema` with schema v1, validators and a migration scaffold
- [x] Project folder manager: create, open, duplicate, rename, delete, JSON index
- [x] Atomic save, recovery snapshots, debounced autosave
- [x] Dashboard: recent projects, new project with format picker, thumbnails
- [x] Dev memory HUD

Exit: create, close and reopen a project. Killing the app mid-save leaves a loadable project.

### M2 Media import

- [x] Native import dialog and drag from Finder, copied into `assets/` with hash de-duplication
- [x] Mediabunny metadata: duration, fps, dimensions, rotation, codec, audio channels
- [x] Proxy queue at 720p H.264 constant frame rate for every video, so the frame rate is constant, cancellable, in a hidden worker window
- [x] Spike 4 result: no separate normalise step; the 720p proxy already converts HDR to SDR, and preview and export match (about 4 to 9 luma levels lighter than Apple's rendering). Send HEVC 10-bit and HDR sources through the proxy queue even at 1080p30, and tune the tone at proxy creation if the lift is too visible
- [x] Portrait sources: size the proxy to the real picture, not pillarboxed inside 1280x720 (spike 4)
- [x] Thumbnails and filmstrip sprite strips into `cache/`
- [x] Waveform peak files into `cache/`
- [x] Media panel: grid, search, filter, duration and resolution, unused-asset cleanup, missing-media relink

Exit: 10 phone clips imported with proxies in under 2 minutes, memory within the M2 budget.

**Status: built and verified.** An end-to-end run in the real app passes 59 of 59 checks (`docs/reports/M2.md`); 10 synthetic clips plus audio and an image were processed in about 24 seconds on the 24GB dev Mac. An independent review found 13 issues: 11 fixed, 2 noted in the report. Still to confirm on the 8GB Mac with real phone footage: the 2-minute exit bar and the M2 memory budget.

### M3 Preview engine

- [x] Generic composition in `remotion-engine` built from project JSON, memoised per clip
- [x] Video, image and audio elements on `@remotion/media`, proxy in preview and original in export
- [x] Mount window around the playhead with Sequence premount
- [x] Player wired to Zustand: play, pause, seek, frame step, timecode, aspect ratio
- [x] Append a clip to the timeline from the media panel, no other editing yet
- [x] Bundled fonts loaded through `@remotion/fonts`

Exit, Gate 1: create a project, import two videos, preview, save, reopen, preview restored.

**Status: built, Gate 1 automated.** 37 of 37 checks pass (`docs/reports/M3.md`). Finding: Remotion's media cache has a 240MB minimum, not 200MB; below it the player silently falls back to a native video tag. The sequence strip is read-only until M4. Still to confirm on the 8GB Mac: Gate 1 with real footage, the memory budget, and audio sync by ear.

### M4 Timeline

- [x] `editor-core` commands with inverse patches and unit tests: add, move, trim, split, delete, duplicate, reorder tracks
- [x] Ruler, playhead, zoom, horizontal scroll, virtualised rows and clips
- [x] Pointer-capture drag, trim handles, snapping to clip edges, playhead and markers
- [x] Multi-select, context menu, keyboard shortcuts
- [x] Track add, delete, lock, visibility, mute
- [x] Filmstrips and waveforms drawn on clips
- [x] Inspector per clip type, canvas selection and drag to position

Exit: rough-cut a 10-clip vlog by hand. Fifty undo and redo steps leave the project identical. Timeline scrolls at 60fps with 100 clips.

**Status: built and verified.** 55 of 55 checks pass (`docs/reports/M4.md`): a 10-clip rough cut made by hand in the real app, 50 undo and 50 redo steps return identical projects, and 100 clips scroll at about 120fps on the dev Mac (60fps bar). New package `editor-core` holds the commands, undo history and snapping. Finding: the timeline and undo history add no measurable memory; scrubbing across many clips fills the 240MB decoded-frame cache, bringing the editor tab near its 600MB bar on the dev Mac. Still to confirm on the 8GB Mac: the rough cut with real footage, 60fps scrolling and the editor memory bar.

### M5 Editing features

- [x] Text clips with style controls and entrance and exit presets
- [x] Audio volume, mute, fades, detach audio from video
- [x] Speed with ripple
- [x] Crop, fit mode, flip, rotation, opacity
- [x] Fade and dissolve transitions with handle validation
- [x] Markers

Exit: a complete vlog with music, titles and transitions, no external tool.

**Status: built and verified.** 78 of 78 checks pass (`docs/reports/M5.md`): a complete vlog with music, two titles, a dissolve and a slide made in the real app, saved, reopened identically and played through in real time. Transitions sit centred on the cut (clip positions never move) and come as dissolve, slide and wipe; titles have fade, slide up, pop and typewriter, which never splits a Bengali conjunct; crop is set on the preview or in the inspector. Schema v1 is unchanged. Also fixed: playback jumped back to frame 0 at the end (an M3 bug). Not yet checked: sound by ear (speed changes pitch) and export fidelity, which M6's golden-frame test covers. Still to confirm on the 8GB Mac: the vlog with real footage and the memory bars (809MB total, 416MB editor tab on the dev Mac).

### M6 Export

- [x] Hidden render window running `renderMediaOnWeb()` on a validated snapshot, output streamed to disk through IPC
- [x] Export dialog: 1080p or 720p, fps, destination, versioned filenames. Export runs at the project's frame rate; there is no fps picker
- [x] Progress, estimated time, cancel, error surface, log file per export
- [x] Export history in the project folder
- [x] Golden-frame test comparing a preview still with the export at five frames
- [x] Conditional on spike 3: `@remotion/renderer` fallback at concurrency 1. Not needed: spike 3 passed, so none was built

Exit, Gate 2: the real user exports a real vlog. Audio is still in sync at the 5-minute mark.

**Status: built and verified.** 34 of 34 checks pass (`docs/reports/M6.md`): a vlog with a dissolve, a Bengali title and music exported from the real app at 720p and 1080p, H.264 and AAC at the project's frame rate, matching the preview at five golden frames (mean difference 4.6 to 5.7 of 255); cancel and a mid-render failure keep no file; history in `exports.json` and a log per export. Export history is kept out of `project.json`, so schema v1 is unchanged. On the dev Mac a 16.7-second vlog exports in about 4 seconds and total memory peaks around 1.08GB. Still to run, as Gate 2 on the 8GB Mac with real footage: the 5-minute export, sync at the 5-minute mark and the 1.5GB peak.

### M7 Reliability and release

- [x] Crash recovery flow, missing media and disk-full handling
- [x] Performance pass against the budget table
- [x] Shortcut sheet, empty states, first-run guidance
- [x] DMG, update channel, crash reporting. Code signing and notarisation only if a paid Apple Developer account is approved: not approved, so the DMG is unsigned (ad-hoc signature)
- [x] Acceptance scenarios from the spec run as a release checklist (`docs/release-checklist.md`)

Exit: V1 installed on the user's Mac and used for a published video.

**Status: built and verified on the dev Mac** (`docs/reports/M7.md`). Decided with the user before building: a manual update check (no auto-update, which needs a signed app), local-only crash reporting (log file, local minidumps, a Report a Problem dialog that copies details), unsigned with an ad-hoc signature, and the acceptance scenarios as a checklist with what can be automated automated. Reliability: a force-quit mid-edit is detected on the next start (session lock) and the dashboard offers the project edited last; a failed save is retried every 5 seconds with a banner that says why, and leaving or closing with an unsaved failure asks first; a missing file is named in a banner and in the export error, including one lost mid-export; a full disk is caught before an export starts and explained in plain words on import, save and export (tested on a real 1.5GB disk image). Also: `?` shortcut sheet, first-run steps on an empty project, a log with local crash dumps, the media queue pausing while an export runs, a production CSP without localhost. Still to run by hand on the 8GB Mac with real footage: Gate 2 (5-minute export, sync, the 1.5GB peak), the memory bars, and the checklist's hand column. The exit (installed and used for a published video) is the user's.

### M8 Business Studio

Moved out of V1 on Nov 14, 2026. It keeps its number; when it is built is decided in `docs/phase2-plan.md`.

- [ ] Product record and brand kit with logo, colours and fonts
- [ ] Three templates: product reel 9:16, collection showcase 16:9, price card 4:5
- [ ] Template instantiation with text layers bound to product fields
- [ ] Duplicate-to-format flow from Journey D
- [ ] SQLite with Drizzle only if the catalogue needs queries the JSON index cannot answer

Exit: a saree reel from a product record and raw footage in under 10 minutes.

## Risks and decision gates

The spike retires the two biggest risks in the spike. The rest are watched at the milestone named.

| Risk | Likelihood | Impact | Mitigation | Decided at |
| --- | --- | --- | --- | --- |
| Web renderer cannot handle a 5-minute 1080p export within budget | Medium | High | Spike 3. Fallback is the Node renderer at concurrency 1, which the Electron template already supports | Spike |
| Remotion DOM preview too slow with three video layers | Medium | High | Spike 2. Fallback is a PixiJS canvas compositor with the same project schema | Spike |
| iPhone HEVC or HDR fails to decode or exports washed out | High | Medium | Spike 4. Fallback is mandatory H.264 SDR normalisation at import, which costs disk, not memory | Spike |
| Web renderer is young and moves fast | High | Medium | Pin every Remotion package to one version, upgrade only between milestones, keep the golden-frame test | Ongoing |
| Timeline takes longer than planned | High | Medium | It is the largest milestone. If it slips, cut multi-select and context menus to M7 | M4 |
| Undo history or filmstrips leak memory over a long session | Medium | Medium | Memory HUD from M1, a 1-hour editing soak test in M7 | M7 |
| Preview and export differ | Low | High | Same composition and same media tags in both. Golden-frame test in M6 | M6 |
| Project corruption | Low | High | Atomic writes, 20 recovery snapshots, validation on load | M1 |
| Remotion licence | Low | Low | Free for individuals and companies of 3 or fewer. Revisit if the business grows past that | M8 |
| 8GB Mac swaps during playback or export | High | High | Budgets set for 8GB, proxies by default, swap logged in every spike run and in the M7 soak test | Spike |

Decision gates, in order:

1. End of spike: web renderer or Node renderer, Remotion DOM or canvas compositor, normalise at import or not.
2. Gate 1 after M3: the vertical slice works and the M2 and M3 budgets hold. If not, no timeline work starts.
3. Gate 2 after M6: the acceptance test passes on real footage. If not, M7 absorbs the fixes and M8 moves.

## Open questions and references

- [ ] Availability: the dates assume full-time. Part-time stretches the dates but not the order.
- [x] Editor Starter: decided Nov 10, not bought (no expenses). We build from the Electron template and read its public docs for approach.
- [x] Target Mac: decided Nov 10, 8GB Apple Silicon. The budget table is set for it.
- [ ] Captions: V1.5 with local whisper.cpp, or later. Only the reserved track type is in V1.
- [ ] Business Studio catalogue: how many products and whether they are shared with a shop system. This decides whether M8 needs SQLite.
- [x] Code signing: notarisation needs a paid Apple Developer account ($99 a year). With no expenses, V1 ships unsigned and is opened once through System Settings, Privacy & Security, Open Anyway. Confirmed with the user at M7.

**Reference projects**, read for their approach, not forked:

| Project | Why it matters | Licence |
| --- | --- | --- |
| [Remotion Electron template](https://www.remotion.dev/docs/electron) | Starting point for the spike and M1. Main-process render, packaged bundle, preload API | Remotion |
| [Remotion Editor Starter](https://remotion.dev/docs/editor-starter) | Timeline, canvas, client-side rendering on the new media tags. Not bought; public docs read for approach | Paid, $600 |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) | Only open project with Electron, Remotion, `@remotion/media` and the web renderer together. Read `desktop/` and `remotion/` | AGPL-3.0 |
| [openvideo react-video-editor](https://github.com/openvideodev/react-video-editor) | The fallback canvas compositor on PixiJS and Mediabunny. Former designcombo Remotion editor | Free for 3 or fewer employees |
| [omniclip](https://github.com/omni-media/omniclip) | WebCodecs-only browser editor, useful for decode and encode patterns | MIT |

**Sources**

- [Remotion web renderer](https://www.remotion.dev/docs/web-renderer/) and [client-side rendering limitations](https://www.remotion.dev/docs/client-side-rendering/limitations)
- [Video from @remotion/media](https://www.remotion.dev/docs/media/video) and [media cache](https://www.remotion.dev/docs/media/cache)
- [Comparison of video tags](https://www.remotion.dev/docs/video-tags)
- [Mediabunny supported formats](https://convert.remotion.dev/docs/mediabunny/formats)
- [Editor Starter FAQ](https://www.remotion.dev/docs/editor-starter/faq) and [client-side rendering in the Editor Starter](https://remotion.dev/docs/editor-starter/client-side-rendering)
- Original specification: `remotion-video-editor.txt` in the project folder
