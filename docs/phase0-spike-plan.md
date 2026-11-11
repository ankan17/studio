# Phase 0: spike implementation plan

> Exported from the Claude Docs plan "Studio Video Editor: Project Plan" (https://claude.ai/artifact/PXtzMhasq6GKDU3oH1MBut) on 2026-11-11. The live doc is the source of truth; diagrams exist only there.

Nov 10, 2026 · @Ankan

One throwaway repo, seven experiments. The spike ends with three decisions written down: web or Node renderer, DOM or canvas compositor, normalise at import or not. Editor Starter is already decided: not bought, we build. Every memory bar is set for the 8GB editing Mac. Experiment 1 gates everything, so it runs first.

## At a glance

*(Diagram in the live doc: spike week, 7 experiments, 1 gate.)*

Arrows are hard dependencies. Experiment 6 produces the proxies experiment 2 plays, and experiment 4 reruns experiments 2 and 3 on iPhone footage.

## Setup

The harness comes first: every experiment is judged on its memory log, and experiment 1's protocol is how every other experiment reads media.

- [ ] Scaffold `studio-spike` from the official Remotion Electron template. Pin every `remotion` and `@remotion/*` package to one exact version, and pin `mediabunny` to the version that `@remotion/media` resolves
- [ ] Add `@remotion/player`, `@remotion/media`, `@remotion/web-renderer`, `@remotion/transitions`, `@remotion/fonts`
- [ ] Turn on context isolation, turn off Node integration, expose a small typed preload API (`openFile`, `startRender`, `cancelRender`, `metrics`)
- [ ] Memory sampler in main: `app.getAppMetrics()` every 250ms, sum `memory.workingSetSize` across all processes, tag each sample with process type and window name, log swap used from sysctl vm.swapusage every second, write `spike/runs/<exp>-<timestamp>.csv`
- [ ] Overlay HUD in the editor window: total RSS, per-process RSS, dropped frames, current fps
- [ ] `spike/RESULTS.md` with one block per experiment: date, Remotion version, fixture, peak RSS per process, wall time, pass or fail, note
- [ ] `spike/fixtures/` (git-ignored) with the clips listed under Before starting

## Experiments

They run in dependency order: 1, 6, 2, 3, 4, 5, 7. Experiment 1 gates the rest, so a failure there is fixed before anything else starts.

Every run happens on the 8GB editing Mac with only the spike app open. On 8GB, swap growing during a run is a fail even when RSS is under its bar, because that is when playback stutters.

### Experiment 1: media protocol with Range

1. Register `media` as privileged before `app.ready`: `standard`, `secure`, `stream`, `supportFetchAPI`, `corsEnabled`.
2. Handle it with `protocol.handle`. Parse the `Range` header, open the file with `fs.createReadStream({ start, end })`, wrap it with `Readable.toWeb`, return `206` with `Content-Range`, `Content-Length`, `Accept-Ranges: bytes` and the right MIME type. No range means `200` with the whole stream.
3. Reject paths outside an allow-listed root to keep the renderer from reading arbitrary files.
4. Composition with one `<Video>` from `@remotion/media` pointing at `media://` on a 4K fixture, inside `<Player>`.
5. Log every request range in main. Seek to 20 random frames and step frame by frame across a keyframe boundary.

- [ ] Pass: seeks land on the requested frame (compare against a `CanvasSink` frame from Mediabunny), and the log never shows a 0-to-EOF read
- [ ] Record: request count and bytes read per seek, peak editor RSS
- [ ] Fail action: fix before moving on. Common causes are a missing `corsEnabled` privilege or a non-206 response

### Experiment 6: proxies, thumbnails, peaks

Runs before experiment 2 because its 720p proxies are experiment 2's input. Mediabunny needs WebCodecs, which Node lacks, so the work runs in a hidden worker window, not the main process. Main only hands it paths and receives progress.

1. Hidden `BrowserWindow` (`show: false`) loading a worker page with the same preload.
2. Proxy: `Conversion` from the 4K fixture to 720p H.264 MP4, constant 30fps, AAC passthrough or re-encode, streamed in chunks over IPC to main, which writes the file.
3. Thumbnails: `CanvasSink` at 160px wide, 60 evenly spaced timestamps, packed into one JPEG sprite.
4. Peaks: `AudioSampleSink`, max absolute value per 10ms window, quantised to 8-bit, written as a `.peaks` file.

- [ ] Pass: proxy wall time below clip duration, main-process RSS flat (within 50MB of baseline) throughout
- [ ] Record: wall time per task, worker window peak RSS, proxy file size
- [ ] Fail action: FFmpeg sidecar for proxies only in M2, Mediabunny keeps metadata, thumbnails and peaks

### Experiment 2: three-layer playback

1. Composition at 1920x1080, 30fps: three `<Video>` layers on the experiment 6 proxies (full frame, picture-in-picture, picture-in-picture), one text layer with a shadow, one `<Audio>` music track.
2. Set the media cache cap the plan names (`mediaCacheSizeInBytes`, around 200MB on 8GB).
3. Play 60 seconds from the start, then 60 seconds from a mid-point after a seek. Count rendered frames with `requestVideoFrameCallback` or the Player's frame events.

- [ ] Pass: steady 30fps (no more than 1% dropped frames), editor window under 600MB, total app under 1.2GB, no swap growth
- [ ] Record: fps over time, dropped frames, editor and GPU process RSS
- [ ] Fail action: PixiJS canvas compositor before M4. Note how far off we were, since a near miss may be fixed by premount tuning instead

### Experiment 3: web renderer export

This result sets the whole M6 design, and the render path has the most moving parts.

1. Editor serialises the composition props and sends them to main through `startRender`.
2. Main opens a hidden render window with the same preload and passes the props.
3. Render window calls `renderMediaOnWeb()` on a 2-minute 1080p30 composition built from the experiment 2 layers, but on the 4K originals, with H.264 video, AAC audio, MP4 container and a cache cap around 300MB.
4. Output goes through `outputWritable` to IPC chunks; main appends them to a file with an `fs.WriteStream`. Nothing is buffered whole in either process.
5. Progress events go back to the editor. Cancel closes the render window.
6. While it renders, scrub and play in the editor to check it stays responsive.
7. After it finishes, destroy the render window and keep sampling for 30 seconds.

- [ ] Pass: peak total under 1.5GB, no swap growth, wall time under 8 minutes (4x realtime), editor still plays during the render, file plays in QuickTime with audio in sync at the end
- [ ] Pass: cancel mid-render leaves no zombie process and returns memory within 30 seconds
- [ ] Record: peak RSS per process, wall time, output size, memory 30 seconds after window close
- [ ] Fail action: `@remotion/renderer` with concurrency 1 for M6, run the same composition once through it so M6 has a baseline figure

### Experiment 4: iPhone HEVC, 60fps, HDR

1. Read each iPhone fixture with Mediabunny and record codec, colour primaries, transfer (HLG or PQ), fps and rotation.
2. Swap the experiment 2 layers for the HEVC HDR clips, unproxied and proxied. Repeat the playback run.
3. Repeat the experiment 3 export with the HEVC HDR originals.
4. Screenshot the same frame in QuickTime (source), the Player, and the exported MP4. Compare side by side on the same display.

- [ ] Pass: decodes in both paths at budget, export colours match the preview with no grey, flat or washed-out look, portrait clips are rotated correctly
- [ ] Record: decode errors, fps, peak RSS, the three screenshots in `spike/runs/exp4/`
- [ ] Fail action: mandatory H.264 SDR normalisation at import in M2. Note whether the proxy step already fixes it, since then normalisation is the proxy

### Experiment 5: fonts and style fidelity

1. Bundle Noto Sans Bengali and one Latin display font, load both through `@remotion/fonts` from local files. Block network in the render window to prove nothing is fetched.
2. Composition: a Bengali title with a box-shadow, a blurred background layer, and a dissolve via `@remotion/transitions` between two clips.
3. Capture five frames with `renderStillOnWeb()` and the same five from the exported MP4. Compare with a pixel diff (`pixelmatch` or similar).

- [ ] Pass: no frame differs beyond codec noise, Bengali conjuncts shape correctly, shadow, blur and dissolve all appear in the export
- [ ] Record: diff percentage per frame and per style, the five diff images
- [ ] Fail action: drop each unsupported style from the V1 text feature list and note it in the plan

### Experiment 7: reference review

With no budget for the $600 Editor Starter, that gate is closed: we build from the Electron template. This experiment shrinks to reading free sources for their approach.

- [ ] Editor Starter public docs and FAQ: timeline units, state and undo model, how it uses the web renderer
- [ ] OpenChatCut `desktop/` and `remotion/`: how it wires Electron, `@remotion/media` and the web renderer. AGPL-3.0, so read for approach and copy no code
- [ ] omniclip: WebCodecs decode and encode patterns. MIT, so code can be borrowed with attribution
- [ ] Write what we take from each into `spike/DECISIONS.md` as approach notes for M3 and M4

## Results and decisions

The spike closes with a written decision for each of the three open gates and the main plan updated to match. M1 does not start until this is done.

### Results (Nov 10, 8GB MacBook Air M1)

All figures below were measured on the 8GB target Mac (M1 MacBook Air), with other apps open and swap flat at 0.8GB used, so swap growth is not a strong signal. The earlier 24GB dev Mac figures are kept in the repo notes. Full figures and caveats are in `spike/RESULTS.md` in the spike repo.

- Experiment 1 (media protocol): pass, 12 of 12 cold seeks on the requested frame, no whole-file reads (at most 8.1MB per seek), run on the 519MB portrait clip.
- Experiment 6 (proxies): passes: the 7.2 min portrait clip proxied in 41.5s (10.5x realtime). Main-process growth was 35 to 51MB against a 50MB bar, measured from the first sample not a settled baseline, so one clip is a marginal miss.
- Experiment 2 (three-layer playback): 29.9fps per layer, editor tab 396MB (bar 600MB), total 741MB (bar 1.2GB), 0.3% dropped. Pass, one run only.
- Experiment 3 (web export): 2-minute 1080p in 41.1s (0.34x realtime, bar 4x), peak 1.11GB against a 1.5GB bar, clean cancel, audio in sync by ear. Pass with a thin memory margin. Editor responsiveness evidence is weak (max frame gap 50ms), and one extra utility process stays after the render window closes.
- Experiment 4 (iPhone HEVC HDR): decode and portrait rotation work, and a 10s single-layer export matches the proxy used for preview. Against Apple's own colour-managed rendering of the HLG clip, both are about 2 to 8 luma levels lighter (a mild lift, not washed out), and export and original looked the same in QuickTime by eye. The Player cropped the portrait clip until the video element was given an explicit size; fixed. Result: no separate normalise step is needed, because the proxy step already converts HDR to SDR; tune the tone there if the lift is too visible.
- Experiment 5 (fonts and style): Bengali shaping, shadow, blur and fade match between still and export (PSNR 40 to 42 dB, bar 35). The shader `dissolve` needs Chrome 149 and Electron has 148, so V1 uses non-shader transitions.
- Experiment 7 (reference review): Editor Starter docs are not public beyond a landing page; OpenChatCut and omniclip approach notes are in `spike/DECISIONS.md`.

Gates, confirmed on 8GB: web renderer, Remotion DOM compositor, no separate normalise step (the proxy step is the normalisation). The 8GB margin on export memory is thin, so watch it as compositions get heavier; the Node renderer stays the fallback.

- [ ] Finish `spike/RESULTS.md`: every experiment has a pass or fail with figures, not impressions
- [ ] Write `spike/DECISIONS.md` with the three end-of-spike gates, plus the Editor Starter decision, each with the experiment that decided it
- [ ] Turn every failed experiment's fail action into a task in its milestone, and delete the conditional tasks that no longer apply
- [ ] Update the budget table if a measured figure shows a budget was wrong, with the measurement beside it
- [ ] Copy the `media://` handler, memory sampler and HUD into a `carry-over/` folder for M1; everything else in the repo is thrown away

## Before starting

You are providing the footage. The spike runs on the 8GB editing Mac itself, since that machine sets every memory bar. Nothing here costs money.

| Input | Used by | Detail |
| --- | --- | --- |
| Two 4K phone clips, 1 to 3 minutes each | 1, 2, 3, 6 | From you, straight off the phone, not re-exported |
| Three iPhone clips: HEVC 60fps, HDR (HLG), one portrait | 4 | From you, shot with the phone's default camera settings |
| One 1080p30 H.264 clip | 2, 5 | From you, any source, used as a known-good control |
| A 3-minute music track | 2, 3 | From you, MP3 or AAC |
| Noto Sans Bengali and one Latin display font | 5 | Free fonts under the SIL Open Font License |
| Test Mac | All | The 8GB editing Mac |

Open questions:

- Code signing in M7: notarisation needs a paid Apple Developer account ($99 a year). With no expenses, V1 ships unsigned and is opened once with right-click, Open. Fine for personal use; confirm before M7.
