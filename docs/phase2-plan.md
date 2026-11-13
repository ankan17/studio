# Studio Phase 2: automatic reels

> Live doc: "Studio Phase 2: Automatic Reels" (https://claude.ai/artifact/MzYGxGfxpDTRj31Yq1nCZy), created 2026-11-13 from this file. The pipeline diagram exists only there.

Nov 13, 2026, revised and approved Nov 14. Follows `docs/project-plan.md` (Phase 1, M1 to M7 built). Nothing here is built yet. The agentic work is split in two (agreed Nov 13): this phase ends with reels generated automatically; the chat editor is Phase 3, in `docs/phase3-plan.md`.

## Summary

Phase 2 adds three things on top of the hand editor:

1. **Reel generator.** Pick a video (or several clips), describe 2 or 3 reels in words, pick a format (Highlights, Talk, How-to, Showcase, Montage) and a style (Clean, Aesthetic, Cinematic, Energetic, Moody) per reel. Studio analyses the footage on the Mac, asks a cloud model to plan the cuts, and creates each reel as a normal 9:16 project that opens in the timeline and can be edited by hand.
2. **Looks.** Real colour grading with LUT files, used by the styles and available by hand in the inspector.
3. **Auto captions.** Made from the same transcript the reel planner uses, in Bengali and English.

The app keeps working fully without an API key. AI is an optional layer, not a dependency.

The split puts every unproven part (the LUT effect, Bengali transcription, the quality of the planned cuts) in this phase, and leaves Phase 3 as engineering on top of commands that already exist. Phase 2 ends in a release that is useful by itself.

## Review: what Phase 1 left us

**Built and verified on the dev Mac (M1 to M7):** projects with atomic saves and recovery, media import with 720p proxies, filmstrips and peaks, a preview and export that share one composition, a full timeline (move, trim, split, snap, multi-select, undo), speed, crop, rotation, titles with Bengali, fade, slide and wipe transitions, markers, MP4 export at 720p and 1080p, crash, missing-media and disk-full handling, and an unsigned DMG at version 0.7.0.

**Still open from Phase 1:**

- Gate 2 has never been run: a real 5-minute vlog on the 8GB Mac, audio sync at 5 minutes, the 1.5GB export peak. The hand column of `docs/release-checklist.md` is also unticked. The Phase 1 plan says nothing starts after a gate until it passes.
- M8 Business Studio (product record, brand kit, three templates) is not started.
- Every memory figure after the spike comes from the 24GB dev Mac with synthetic clips.

**What the foundation already gives an agent:**

- `packages/editor-core` has 20 commands that are plain data, never generate ids, refuse illegal edits with a sentence, and return inverse patches. This is the tool surface. It has no React or Electron in it, so it can run in main.
- `ProjectComposition` is the single renderer for preview and export, so anything an agent builds from commands exports exactly as it previews.
- The hidden media worker and its one-job-at-a-time queue (paused during export) is the place to run footage analysis within the memory budget.
- The `caption` track type is reserved in schema v1.
- Remotion 4.0.542's `<Video>` already has an `effects` prop with a WebGL2 backend (`remotion/dist/cjs/effects/effect-types.d.ts`). A LUT can be a custom effect on the existing component, so LUT grading does not need the separate canvas compositor the spike ruled out. This is unproven here and is spike S1.

**Gaps this phase must close** (the chat editor's own gaps are in the Phase 3 plan):

| Gap | Why it matters |
| --- | --- |
| The app knows nothing about what is in the footage | No shots, no transcript, no beats; the model cannot plan from file names |
| No colour field on clips, no caption clips | Looks and captions need schema v2 through `migrateProject` |
| No picture fade, slide and wipe go one way only | Presets will want both (M5 notes); small command and schema additions |
| Duplicating a project copies every asset with `fs.cp` | Three reels from one 2GB video would store it three more times |
| No network code, no settings, no secrets store, no music | The check for updates is the only network call today; beat-cut reels need music the user may not have |

## Decisions taken (Nov 13, with the user)

| Decision | Choice |
| --- | --- |
| Where the AI runs | Analysis on the Mac; planning by a cloud model. Transcript text and a few small sampled frames leave the Mac, the video never does |
| API key | The user's own, entered in a new Settings screen. Never shipped in the app |
| Providers | Anthropic and OpenAI. The code is provider-agnostic; the provider is detected from the key |
| Reel types | Both speech-driven (vlog highlights) and visual (saree and product B-roll to music) in the first release |
| Presets | Real grading with LUTs, plus pacing, transitions, titles and captions |
| Agent scope | Reel generator and a full chat editor, in two phases: the reel generator here, the chat editor in Phase 3 |
| Presets (Nov 14) | Format × style: the brief picks one of five formats and one of five styles, replacing the single preset list |
| Gate 2 (Nov 14) | Run with the hand checklist during the spikes, before M10 |
| Speech languages (Nov 14) | Bengali first, English second. Bengali transcription is on the critical path, not an extra |
| Server (Nov 14) | None. The app is for the user alone, on their own key, calling providers directly from main |
| Bengali fallback (Nov 14) | If S2 shows local Bengali transcription is not good enough for a job, Bengali audio goes to OpenAI's transcription, with consent each time. The video never leaves the Mac |
| Transcription choice (Nov 14) | Chosen separately for its two jobs in S2: planning tolerates errors, captions do not. Likely outcome: local for planning, cloud for captions |
| Music (Nov 14) | A free music library browsed from inside the app (service chosen in S6), plus the user's own tracks |
| Formats in 1.1.0 (Nov 14) | Talk, Highlights, Showcase, Montage, each still passing S3. How-to is defined but comes after 1.1.0. All five styles ship |
| Talk cutaways (Nov 14) | Built in M12 |
| Versions (Nov 14) | V1 ships as 1.0.0 once Gate 2 and the hand checklist pass, during the spikes; this phase ships as 1.1.0 |
| M8 Business Studio (Nov 14) | After this phase, built on the Showcase format; moved out of V1 in `docs/project-plan.md` |

This reverses two statements in the Phase 1 plan, edited on approval (Nov 14): "It is not an agentic editor" now applies to V1 only, and colour grading moved from "Out, not planned" to this phase. The Phase 1 plan never promised no network calls in writing; the update check was already one. `PRODUCT.md`'s positioning now says AI features are optional and use your own key.

## How it works

### Process model

Main gains one service. The renderer and the worker windows never talk to the network and never hold the key.

| Part | Where | Job |
| --- | --- | --- |
| `ai-service.ts` | main | Holds the key, calls the provider, runs reel jobs, writes the usage log |
| `packages/ai-core` (new, pure) | used from main | Provider interface, key detection, prompts, the reel plan schema, the plan compiler. No Electron, tested with vitest |
| Analysis stages | media worker window | Shots, sampled frames, beats, and transcription if the spike allows it in-window |
| Settings, reel brief | editor window | UI only; sends briefs, receives progress and the finished reels |

The production CSP stays as it is, because requests go out from main, not from a window.

No server: the app is for the user alone (decided Nov 14), the key is theirs, and requests go straight from the Mac to the provider. A server becomes necessary only if Studio is given to others on the user's key (sign-in, a proxy holding the key, per-person caps), which would be its own milestone.

**Allowed hosts.** Every outgoing request goes through one `net-client.ts` in main that refuses any host not on a fixed list: the two AI providers' API hosts, the chosen music service's hosts, and GitHub for the update check. Redirects to another host are refused too. A bug, or a hostile transcript that talks the model into naming a URL, cannot make the app fetch anything else.

### Key and providers

- **Storage:** Electron `safeStorage` (Keychain-backed) in the app data folder. The key crosses IPC once, when typed; main never sends it back, only the provider name and the last four characters. It is never written to `studio.log`, crash details or project folders: the logger and the crash dump writer scrub anything that looks like a key (`sk-` followed by key characters) before writing.
- **After an update:** the builds are ad-hoc signed, so the signature probably changes with each build and macOS may ask again for the stored key, or refuse it (unverified for Studio). If decryption fails, Settings says the key needs entering again; the app never crashes on it and never deletes the stored key on its own.
- **Detection:** `sk-ant-` means Anthropic; any other `sk-` means OpenAI; anything else asks the user to pick. Saving runs one cheap test call and reports "works" or the provider's error in plain words.
- **Interface:** one `ModelProvider` with `complete({system, messages, images, schema})` returning a reply validated against the schema, and token usage. Two adapters, each on the provider's official SDK (`@anthropic-ai/sdk`, `openai`). Prompts and the reel plan schema are written once against the interface. Tool calling is added to the interface in Phase 3, when something uses it.
- **Models:** one default per provider, changeable in Settings. Anthropic: `claude-opus-5-5`. OpenAI: chosen in spike S3 from what the key can list.
- **Cost:** a rough estimate for one run of three reels from a 10-minute video is 30,000 input tokens (transcript plus about 40 frames at 512px) and 3,000 output tokens, about $0.20 at Opus 5.5 prices ($4 and $20 per million). Spike S3 replaces this guess with a measurement. Settings shows tokens and estimated spend per job and per month, with an optional monthly cap.

### Footage analysis (local)

New stages in the existing media queue, written to `cache/analysis/<sha>.json` per asset, so they are rebuildable and never in `project.json`:

| Output | How | Used for |
| --- | --- | --- |
| Shots | Frame differences on the 720p proxy at low resolution | Legal cut points; a shot table for the model |
| Shot measures | Sharpness, brightness, motion per shot | Dropping blurred or dark shots before the model sees them |
| Sampled frames | One or two small JPEGs per shot | The only pictures sent to the model |
| Transcript | Speech recognition with word timings (local or cloud, per S2) | Choosing moments by what is said; captions |
| Beats | A beat grid with a strength per beat, from the music track | Cutting reels on the beat |

Transcription is the hard one. Base Whisper models are weak on Bengali; Bengali fine-tunes exist, but the small ones report roughly 33 to 44% word error rate on benchmarks and the best medium one about 24%, all on cleaner speech than a vlog with English mixed in. A medium model (roughly 1 to 2GB, unmeasured) cannot sit beside an open editor on 8GB.

The transcript has two jobs with different bars, so S2 chooses for each separately:

- **Planning** (picking moments, the hook line, cut points): the model only needs the gist, so a local model with many word errors may be enough. Word timings are required.
- **Captions** (read by viewers): every wrong word is a hand fix, so it needs the most accurate option available. Word timings are required.

The likely outcome is local transcription for planning, free and with the audio kept on the Mac, and OpenAI's transcription for captions when the user turns them on, with consent per job. S2 also decides between a whisper.cpp sidecar binary (the Phase 1 plan's choice for captions) and an in-window build, and whether the local model runs only while no project is playing.

### Planning a reel

The model never writes project JSON. It returns a small plan, and code turns the plan into commands.

1. **Brief.** The user picks source media, writes one description per reel, and picks a format, a style, a length (15, 30, 60 or 90 seconds) and a music track, from the project's own audio or the music library.
2. **Context.** Main assembles the shot table, the transcript, the sampled frames, the format's and style's rules and the briefs.
3. **Plan.** The model returns, per reel, an ordered list of segments (asset, in and out time, a reason, an optional `newSection` flag, `keepSound` for Highlights, a `cutaway` kind for Talk, a `stepTitle` for How-to), a hook title, a `closingTitle` for Showcase, and the subject's horizontal position per segment. Captions are not in the plan; the reel's path decides them. The reply is validated against a Zod schema.
4. **Compile.** `compileReel(plan, format, style, analysis)` in `ai-core` snaps every cut to a shot edge, a word edge or a beat, enforces the length, applies the format and style (sections, titles, look, transitions, speed, captions, sound) and emits a list of `editor-core` commands. It is deterministic and unit tested without a network.
5. **Create.** Main creates a 9:16 project per reel through `@studio/project-store` and applies the commands with `applyCommand`. The reel then opens like any other project.
6. **Regenerate.** "Shorter", "start with the beach shot": the user amends the brief and the planner runs again. The result is a new version beside the old reel, never a replacement, so hand edits to the first one are not lost. Changing a reel in place by instruction needs the chat editor and comes in Phase 3.

Reframing landscape footage to 9:16 is cover fit plus a horizontal offset per segment from the subject position the model reports. It is static per segment: the schema has no keyframes, so a subject that walks across the frame is not followed.

Reels share their source media. The store will clone the asset files (APFS copy-on-write) so each reel project stays self-contained without storing the video again; spike S5 confirms it on the target Mac.

### Presets: format and style

A reel is shaped by two choices the user makes per reel in the brief:

- A **format** says what the reel is: which moments to pick, in what order, which titles it carries, and whether it is cut to speech or to music. Five formats: Highlights, Talk, How-to, Showcase, Montage. How-to is defined here but ships after 1.1.0.
- A **style** says how the reel looks and moves: pacing, slow motion, transitions, colour, typography and sound levels. Five styles: Clean, Aesthetic, Cinematic, Energetic, Moody.

Any style works with any format (25 combinations), so a cinematic product reel or an energetic how-to needs no preset of its own. Both are data files validated by Zod and used twice: their intent and picking rules go to the model as constraints, and their numbers are applied by `compileReel`, which enforces them whatever the model returns. Where a format and a style conflict, the format wins on *what* is picked and the style on *how* it is shown. Every value either one sets is an ordinary clip property afterwards.

#### Review: what the first draft left vague (Nov 14)

The first draft defined two presets in five rows and named two more. None of them could be built or checked as written:

| Draft wording | Problem | Now |
| --- | --- | --- |
| One list: Aesthetic, Cinematic, Energetic, Clean | Mixed what a reel is with how it looks, and was tuned to two kinds of footage (vlogs and saree shoots). A cinematic product reel or a calm tutorial had no preset | Format × style |
| "Teal and orange LUT", "Soft faded warm LUT" | A name, not a look. Our LUTs come from a generator, which needs numbers | Every look has generator parameters (below) |
| "Cuts on strong beats", "every beat" | Onset detection gives onsets, not a beat grid or a strength. At 128 BPM "every beat" is 0.47s, below the 1s minimum the same row sets | A beat grid with an accent rule; the length range wins over the beat rule |
| "0.5x on the most stable shots" | "Stable" is not measured (our motion score mixes camera shake with subject motion). 0.5x on 30fps footage doubles frames and looks stepped. Speed changes pitch, so slowed speech is unusable | Slow motion only on 50fps+ sources, sound muted, never on speech, capped per reel |
| "A fade at section changes" | The plan has no sections | The plan gets a `newSection` flag; formats say where sections fall |
| "Bebas Neue, wide, lower third" | "Wide" needs letter spacing, which `TextSchema` has no field for. A lower third in 9:16 sits under the apps' own caption and buttons. Bebas Neue has no Bengali, so a Bengali title loses the style | Pixel positions inside a stated safe area; `letterSpacing` and `fontWeight` added in schema v2; Bengali fallback stated |
| "Small, centred, lowercase" | No size. Lowercase means nothing for Bengali | Sizes in px on a 1080×1920 canvas; case changes apply to Latin text only |
| "Title and captions" in one row | Titles and captions are different clips with different jobs | Separate tables |
| Pacing in seconds for every reel | A speech reel cut every 1 to 2.5s cuts people off mid-sentence | Separate speech and beat pacing per style |
| Model returns "caption on or off" | Duplicates the preset and lets the model override it | Captions follow the reel's path; removed from the plan |
| Nothing on sound | Music level under speech, the source's own sound, the ending | A sound table per style, and format rules for the source's sound |

Also not possible with a LUT, so left out of every style: film grain, vignette, blur, light leaks, letterboxing, speed ramps (no keyframes), per-shot exposure or white balance correction (a LUT is one fixed mapping for the whole clip).

#### Shared rules

- **Canvas:** 1080×1920, 30fps. Every video segment uses cover fit with the horizontal offset from the plan's subject position, clamped so the picture always fills the frame.
- **Safe area:** text stays inside x 60 to 960px and y 220 to 1440px, which clears the overlays of Instagram Reels, YouTube Shorts and TikTok: a header at the top, buttons on the right, caption and sound rows at the bottom. All positions below are the text box's centre, in px from the top-left.
- **Path:** a reel is cut to speech or to music (the beat path). The format sets which paths it allows and the default; the brief can switch where both are allowed. The beat path needs a music track; the speech path needs a transcript.
- **Cut points, beat path:** S4's beat tracker gives a beat grid (time and strength per beat). An *accent* is a beat whose strength is in the top 25% of the track. The compiler moves each cut to the nearest allowed beat (per the style) that keeps the segment within the style's length range; if none, the nearest shot edge in range; if none, the range's end.
- **Cut points, speech path:** cuts only at word edges, preferring the end of a word followed by a pause of 150ms or more. A segment may run up to 3s past the style's maximum to finish a sentence. Never inside a word.
- **Shot edges:** no segment starts or ends within 4 frames of a shot edge it does not cut on, so no flash frame of the neighbouring shot.
- **Pause tightening** (speech path): pauses longer than the style's limit are cut to 0.15s, making jump cuts. This splits one planned segment into several clips.
- **Slow motion** (where the style allows it): 0.5x only on an asset of 50fps or more, only on segments with no speech and no `keepSound`, sound muted, never more than the style's share of segments. Otherwise 1x. Limit: proxies are capped at 30fps, so slow motion is stepped in the preview and smooth only in the export.
- **Speech** clips always play at 1x with sound at 1.0 and a 3-frame sound fade at each edge, so cuts do not click.
- **Source sound on the beat path** is muted, except segments the plan marks `keepSound` (see Highlights).
- **Music** starts at the track's first beat. On the speech path it is optional (only if the brief picks a track) and plays at the style's level under speech. The schema has no volume automation, so a level change means splitting the music clip: a step with 3-frame fades, not a smooth duck.
- **Length:** the reel ends within 0.5s of the chosen length (15, 30, 60 or 90s). Excess is trimmed from the tails of the lowest-ranked segments. If the plan is more than 10% short, the planner is asked once more, told the shortfall; if still short, the reel is made shorter and the brief screen says so.
- **Transitions** are applied only where `transitionRoom` allows; where not, the cut stays hard. Durations are frames at 30fps.
- **Hook title:** the plan's `hookTitle`, at most 40 characters, on by default for every format; the brief can turn it off.
- **Captions** are on for the speech path and off for the beat path, in the transcript's language. Chunks never cross a sentence end.
- **Text case:** uppercase and lowercase rules change Latin letters only. Bengali is left as written.
- **Fonts:** only the two bundled fonts, Noto Sans Bengali (weights 100 to 900) and Bebas Neue (one weight, Latin only). Bengali text in a Bebas Neue title falls back to Noto Sans Bengali 700.

#### Formats

| Format | For | Path | The model picks | Order and sections | Titles |
| --- | --- | --- | --- | --- | --- |
| **Highlights** | The best moments of any long recording: an event, trip, match, game stream, wedding, class, livestream | Beat by default; speech allowed | Peaks: action, reactions, laughter, applause, the moment something happens. Loud peaks in the waveform are a hint | The strongest moment first as the hook, then the rest in source order. No sections | Hook |
| **Talk** | People speaking: opinions, explainers, podcast and interview clips, talks, reviews, vlogs | Speech only | One complete thought or argument, and a hook line (a strong claim, a surprise, an emotional moment) | Cold open: the hook line from anywhere in the source, at most 5s. Then whole thoughts in source order. Cutaways over the speech where the speaker refers to something shown | Hook |
| **How-to** | Steps in order: recipes, DIY, software demos, make-up, workouts, setups | Speech by default; beat allowed | The key action of each step, and the finished result | The result first (about 2s) as the hook, then the steps strictly in source order, each a `newSection` | Hook, and a numbered `stepTitle` per step ("1 Chop the onions") |
| **Showcase** | One subject presented: a product, dish, room or property, car, outfit, artwork, venue | Beat by default; speech allowed (a voice-over) | A hero shot (the subject whole, well lit, centred), details (texture, features, close-ups), the subject in use or in motion | Hero, details, in use, then the hero again to close; each part a `newSection` | Hook, and a `closingTitle` (the name, plus a price or call to action if the brief gives one) |
| **Montage** | A mood piece to music with no story: travel, nature, a city, a day out, B-roll | Beat only | The best-looking shots that fit the style | Visual flow, not source order: alternate wide and close, keep neighbours similar in brightness and colour, end on the strongest image. No sections | Hook |

Format rules on top of the shared ones:

- **Highlights:** up to 1 segment in 3 may be marked `keepSound` (a cheer, a laugh, a short line). It plays its own sound at 0.8, the music drops to the style's under-speech level for that segment, and slow motion is off for it.
- **Talk:** pauses are tightened at the smaller of the style's limit and 0.4s. Captions are always on. Cutaways (a `cutaway` segment) go on a second video track above the speaker, whose sound continues; they need at least 1.5s of B-roll and never cover the first 2s of the hook.
- **How-to:** each step lasts 2 to 8s whatever the style's range, with at most 8 steps; a step needing more is split by the model into two. The step title shows for the step's first 2s at x 540, y 330, in the style's title font at 75% of its hook size.
- **Showcase:** dark, blurred or subject-cut-off shots are dropped before the model sees them, at stricter thresholds than other formats (set in S4). The last shot is held 3s under the closing title, at x 540, y 1300, in the style's title font. The style's look is replaced by its hue-preserving variant (see Looks), so the subject's colours stay true; a viewer who buys a product in a different colour from the reel has a fair complaint.
- **Montage:** captions are always off, even if the footage has speech.

#### Styles

| Style | Intent, sent to the model | Prefers | Avoids |
| --- | --- | --- | --- |
| **Clean** | Let the footage speak. No styling | The clearest, best-lit, steadiest shots | Blurred, dark or shaky shots |
| **Aesthetic** | Calm, soft, everyday beauty | Details and textures, soft or window light, still or slow camera, quiet moments | Harsh light, clutter, fast action, crowds |
| **Cinematic** | A trailer: open wide, build, end on the strongest image | Wide establishing shots, slow camera moves, silhouettes, depth, close-ups for the human moments | Cluttered frames, shaky handheld, flat light |
| **Energetic** | Momentum from the first frame | The most dynamic shot first, movement toward the camera, action, faces reacting | Static or empty shots, slow moments |
| **Moody** | Quiet and introspective | Low light, night, rain, city lights, single figures, silhouettes, empty spaces | Bright daylight, groups, smiling to camera |

The style ranks shots within what the format needs: a Moody Talk reel still shows the speaker, and only its cutaways lean dark.

**Pacing, speed and transitions**

| Style | Beat path: length, cut on | Speech path: length, pause limit | Slow motion | Transitions | Picture fades |
| --- | --- | --- | --- | --- | --- |
| Clean | 2 to 4s, every 4th beat | 2 to 12s, 0.6s | None | Hard cuts | None |
| Aesthetic | 1 to 2.5s, every 2nd beat | 1.5 to 6s, 0.8s | Up to 1 segment in 4 | Dissolve, 10 frames, on every cut | From black over the first 10 frames, to black over the last 15 |
| Cinematic | 2 to 4s, accents only | 3 to 10s, 0.8s | Up to 1 segment in 3 | Hard cuts; dissolve, 15 frames, at each `newSection` | From black over the first 15 frames, to black over the last 30 |
| Energetic | 0.5 to 1.5s, every beat (every 2nd if beats are under 0.4s apart) | 1 to 4s, 0.25s | None | Hard cuts; slide, 6 frames, at each `newSection` and on accents, alternating left and right, at most 1 cut in 4 | None |
| Moody | 2 to 5s, accents only | 3 to 10s, 1.0s | Up to 1 segment in 2 | Dissolve, 15 frames, on every cut | From black over the first 20 frames, to black over the last 30 |

**Looks**

Each look is a generator recipe, applied to Rec.709 footage in display (gamma-encoded) space, in this order:

1. **Temperature** *t* (−1 to 1): red × (1 + 0.1*t*), blue × (1 − 0.1*t*).
2. **Tone curve:** five control points (input → output), monotone cubic, applied to each channel. Raising the first point fades the blacks; lowering the last softens the whites.
3. **Saturation** *s*: out = luma + (rgb − luma) × *s*, Rec.709 luma weights.
4. **Split tone:** add the hue's colour (full saturation, minus its luma) × amount, weighted by (1 − luma)² for shadows and luma² for highlights.
5. **Skin protect** *k* (0 to 1): for hues 10° to 50° with saturation 0.15 to 0.6 (10° soft edge), blend back toward the colour after step 2 by *k*, so faces do not go orange or grey.
6. Clamp, write a 33³ `.cube`.

Each look also has a **hue-preserving variant** (`<id>-true`), generated from the same recipe with steps 1 and 4 skipped, saturation capped at 1.0, and the tone curve applied to each colour's largest and smallest channel with the middle one placed by its original ratio, so only contrast changes (a per-channel curve shifts hue by up to 3.4° on a colour chart; see S1 in `docs/phase2-spike-results.md`). Showcase uses it; anyone can pick it by hand. Its check is a colour chart frame whose patches keep their hue within 2°.

The clip's `intensity` mixes the original and the graded picture in the shader. Values are starting points; M11 may tune them against real footage, and the style files record the final numbers.

| Look (`lutId`) | Style | Temp | Tone curve (0, .25, .5, .75, 1 →) | Sat | Shadows tint | Highlights tint | Skin | Intensity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | Clean | | | | | | | |
| `soft-warm` | Aesthetic | +0.5 | .07, .28, .52, .76, .94 | 0.80 | 150°, 0.04 | 35°, 0.06 | 0.3 | 80% |
| `teal-orange` | Cinematic | 0 | .02, .19, .50, .81, .97 | 0.95 | 190°, 0.15 | 30°, 0.12 | 0.6 | 70% |
| `punch` | Energetic | 0 | 0, .18, .50, .84, 1 | 1.20 | | | 0.4 | 85% |
| `cool-low` | Moody | −0.5 | .03, .17, .42, .70, .90 | 0.65 | 210°, 0.10 | 200°, 0.04 | 0.4 | 75% |

That is four bundled looks and four variants.

**Titles**

Sizes are px on the 1080×1920 canvas. Enter and exit use the existing title animations (none, fade, slide up, pop, typewriter). The style sets the hook title; the step and closing titles reuse its font, colour, case and animation at the sizes and positions the format gives.

| Style | Font, size, weight | Colour and box | Case, spacing | Hook position (centre) | Hook shown | Enter / exit |
| --- | --- | --- | --- | --- | --- | --- |
| Clean | Noto Sans Bengali 64, 700 | White, shadow 0 2 6 #000 50% | As written | x 540, y 330 | 0 to 2.5s | Fade / fade |
| Aesthetic | Noto Sans Bengali 44, 300 | White 90% | Lowercase, +0.05em | x 540, y 960 | 0.3 to 3s | Fade / fade |
| Cinematic | Bebas Neue 120 | White | Uppercase, +0.15em | x 540, y 1150 | 0.5 to 3.5s | Fade / fade |
| Energetic | Bebas Neue 140 | White, #000 stroke 6 | Uppercase, +0.02em | x 540, y 400 | 0 to 2s | Pop / none |
| Moody | Noto Sans Bengali 40, 300 | White 85% | Uppercase, +0.20em | x 540, y 960 | 0.7 to 4s | Fade / fade |

**Captions** (speech path only)

| Style | Font, size, weight | Colour and box | Words per chunk | Current word | Position (centre) | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| Clean | Noto Sans Bengali 52, 600 | White on a #000 60% box | A phrase, up to 32 characters a line | Not marked | x 510, y 1320 | Up to 2 |
| Aesthetic | Noto Sans Bengali 40, 400 | White, shadow 0 1 6 #000 60% | A phrase, up to 28 characters | Not marked | x 510, y 1300 | 1; lowercase |
| Cinematic | Noto Sans Bengali 46, 500 | White, shadow 0 2 8 #000 70% | A phrase, up to 30 characters a line | Not marked | x 510, y 1320 | Up to 2 |
| Energetic | Noto Sans Bengali 60, 800 | White, #000 stroke 8 | 1 to 3 | #FFD60A; each chunk pops in | x 510, y 1200 | 1 |
| Moody | Noto Sans Bengali 42, 300 | White 85%, no box | A phrase, up to 28 characters | Not marked | x 510, y 1300 | 1 |

x is 510, not 540, so a wide caption clears the buttons on the right.

**Sound**

| Style | Music, beat path | Music under speech | Music ending |
| --- | --- | --- | --- |
| Clean | 0.8 | 0.12 | 30-frame fade |
| Aesthetic | 0.9 | 0.15 | 45-frame fade |
| Cinematic | 1.0 | 0.20 | 45-frame fade |
| Energetic | 1.0 | 0.25 | Ends on the last beat, 10-frame fade |
| Moody | 0.9 | 0.15 | 60-frame fade |

**How formats and styles are checked.** Every rule above that is a number is a vitest on `compileReel` with a fixed plan and fixed analysis: segment lengths in range, cuts on the stated beats or word edges, slow motion only where allowed, transitions and fades as listed, sections and titles where the format puts them, text inside the safe area, reel length within 0.5s. Each look and variant gets a golden frame in the e2e, and identity parameters must give an identity LUT within 1/255. Whether a reel *feels* right is judged only by the user, in S3 and Gate 3, on footage of every shipped format.

**LUTs.** A look is `{lutId, intensity}` on a clip (schema v2). A `.cube` file is parsed once into a 3D texture and applied by a custom WebGL2 effect through Remotion's `effects` prop, the same code in preview and export. Bundled LUTs are generated by our own script from the recipes above, so there is no licence question; the user can import their own `.cube` files, which are copied into the project so it stays self-contained.

### Music library

Beat-cut reels need music, and the user often has none to hand. The brief and the media panel get a music search backed by a free online library.

- **Service:** chosen in spike S6. It must have an official API whose terms allow use from a desktop app; licences that allow commercial use on social platforms with no fee per use (Showcase reels sell things); and downloadable audio files. Candidates to check, none verified yet: Jamendo, Openverse, Pixabay.
- **Licences shown and filtered:** only tracks whose licence allows commercial use and changes (no NC or ND Creative Commons licences) are listed. Each result shows its licence name.
- **Process:** `music-service.ts` in main does the search, the preview and the download. The renderer sends only a search string and a track id, never a URL or a path, through `music:*` IPC with `assertTrusted` and Zod. A preview is downloaded to `cache/` and played through `media://`; the production CSP is unchanged. Picking a track downloads it and imports it through the existing import pipeline (copy, hash, peaks, beats).
- **Download checks:** at most 50MB, through the allowed-hosts client only; written to a temporary file named by Studio, never by the server; opened with mediabunny and refused unless it is audio with a duration; only then moved into `assets/`.
- **Records:** the asset keeps its source, licence and credit line (schema v2). If the licence needs credit, the export panel shows the line to paste into the post's caption.
- **Limit, stated in the app:** a free licence does not stop Instagram's or YouTube's automatic matching from flagging a track. The app cannot promise a reel will not be claimed.
- **Privacy:** search words go to the music service. No key, no footage, nothing else.

### Privacy and consent

A first-use screen says exactly what leaves the Mac (transcript text, shot statistics, small still frames, your instructions) and to which provider. If Bengali transcription runs in the cloud, a second consent, asked per job, says the audio track goes to OpenAI. Each job writes what was sent, without the images' bytes, and its token counts to `<project>/ai/<id>.log`. Nothing is sent until a key is set and the screen is accepted.

Transcripts and file names are untrusted text. In this phase the model's only output is a reel plan that is validated and then compiled by our code into a new project, so the worst a hostile transcript can do is produce a bad reel.

## Schema v2

One migration, done once, covering both phases so Phase 3 needs no second one:

- `clip.look`: `{lutId, intensity}`, optional
- Caption clips on the reserved `caption` track: text with word timings and a style (words per chunk, current-word colour)
- `text.fontWeight` and `text.letterSpacing` (em), needed by the style titles
- `asset.source`: service, track id, licence name and URL, credit line; optional, set only for library music
- Project `luts` manifest (id, relative path, sha256), like assets
- A picture fade on a clip's own edges, and a direction on slide and wipe
- A link id shared by a video clip and its detached sound (written from this phase on; first used by the chat editor in Phase 3)

Reel briefs stay out of `project.json`, in `<project>/ai/`, as export history did.

## Spikes first

Run on the 8GB Mac with real footage (listed in the appendix). Each has a pass bar and a fail action, as in Phase 0.

| # | Experiment | Pass | Fail action |
| --- | --- | --- | --- |
| S1 | A LUT as a custom WebGL2 effect on `<Video>`, three layers playing, then exported | 30fps, editor under 600MB, export matches preview at five golden frames | Bake the look into a graded proxy and grade at export in the render window; if that also fails, CSS-filter looks only |
| S2 | Three candidates on the user's own speech: (a) a Bengali fine-tuned Whisper small through whisper.cpp with the editor open, (b) a Bengali fine-tuned Whisper medium (or IndicWhisper) with the editor idle, (c) OpenAI's transcription. Scored against 2 minutes of Bengali (with its mixed-in English) and 2 minutes of English, both corrected by hand, then timed on a 10-minute clip. Recorded per candidate: word error rate, time, peak memory, whether it gives word timings, model licence | **Planning:** a local candidate under 3 minutes for 10 minutes of audio, total memory under 1.2GB, word timings, and S3's reels judged as good on its transcript as on the corrected one. **Captions:** the candidate that leaves the user under 2 minutes of fixes per minute of speech | Planning: OpenAI's transcription for planning too, with consent per job. Captions: if no candidate passes, captions are typed by hand. If the cloud model lacks word timings, a local alignment step adds them, or `whisper-1` is used while it lasts |
| S3 | Hand-built analysis of one footage set per shipped format (Highlights, Talk, Showcase, Montage; the Talk set in Bengali; the user's own where they have it, licensed stock otherwise, never committed) sent to both providers with two briefs each in different styles | The user would post at least 6 of 8 planned reels after small fixes; tokens and cost recorded | Tighten the plan schema and prompts; if one provider stays poor, ship the other as recommended |
| S4 | Shot detection and a beat grid with strengths on 10 real clips and 3 songs | Under 15 seconds a minute of footage, cuts within 2 frames, beats and accents usable by ear | Fixed-interval sampling in place of shots; manual beat markers |
| S5 | Clone a 2GB asset into a second project | No extra disk used, both projects open after the first is trashed | Reels reference the source project's assets, with a guard on deleting it |
| S6 | Read the terms and try the API of each music candidate: search, preview, download, licence data, and whether it needs an app key | One service meets every condition under Music library and needs no secret key shipped in the app, with its terms saved in `docs/`. A service that needs an app key passes only if its terms allow shipping it in a desktop app | Library dropped; user imports their own tracks, as first planned |

## Milestones

Order of work: the spikes and Gate 2, M9, M10, M11, M12, Gate 3, M13, the Phase 2 release. Phase 3 starts at M14. M8 Business Studio keeps its number and comes after this phase.

### M9 AI foundation
- [ ] Settings screen: key entry, detected provider, test call, model choice, usage and cap
- [ ] `safeStorage` key store in main; `settings:*` and `ai:*` IPC with `assertTrusted` and Zod
- [ ] `net-client.ts`: the allowed-hosts list, redirects refused; the update check moved onto it
- [ ] Key scrubbing in the logger and crash dumps
- [ ] Key that no longer decrypts after an update: plain message in Settings, re-entry, no crash
- [ ] `packages/ai-core`: provider interface, two adapters, key detection, with vitests
- [ ] Consent screen and the per-job log
- [ ] Recorded-response provider for e2e (`STUDIO_E2E_AI_FIXTURE`, ignored in packaged builds), so `verify.py` never needs a network or a key

Exit: a key for each provider is saved, tested and removed; an e2e step searches `studio.log`, crash dumps, project folders and renderer state for the key and finds nothing; a request to a host not on the list is refused; the app is rebuilt and reinstalled over itself on the 8GB Mac and the stored key either still works or asks for re-entry cleanly.

### M10 Footage analysis and captions
- [ ] Shot, measure, frame-sample and beat stages in the media queue
- [ ] Transcription per the S2 result: one engine for planning and one for captions, which may be the same
- [ ] Schema v2 migration (all fields above)
- [ ] Caption track: generate from the transcript, edit text and timing, style, Bengali and English, in preview and export

Exit: a 10-minute real recording with Bengali speech is analysed and captioned on the 8GB Mac within the memory bars, and the captions export correctly.

### M11 Looks
- [ ] LUT effect per the S1 result, `.cube` import, bundled looks
- [ ] `setLook` command, inspector control with intensity
- [ ] Picture fade and transition direction commands
- [ ] LUT generator script, the four bundled looks and their hue-preserving variants, from the recipes in this plan
- [ ] Format and style files and their schemas

Exit: a graded video exports matching the preview at five golden frames, within the export memory bar.

### M12 Reel generator
- [ ] Reel plan schema, prompts, `compileReel` with vitests on fixed plans, one set per format and style rule
- [ ] Brief screen, progress, cancel
- [ ] Reels created as projects with cloned assets; reframing from subject position
- [ ] Both paths: speech-driven and beat-driven
- [ ] Formats Talk, Highlights, Showcase, Montage; Talk cutaways on a second video track
- [ ] Music library per the S6 result: search, preview, download into the project with the download checks, licence and credit kept
- [ ] Regenerate from an amended brief, as a new version beside the old reel

Exit, Gate 3: from one real footage set per shipped format, the user gets two reels each in different styles and posts at least two thirds of them after under five minutes of fixes apiece.

### M13 Reliability and release
- [ ] Offline, bad key, rate limit, refusal, timeout and cap reached, each with a plain message and no half-made project
- [ ] A small fixed evaluation set (briefs and footage analysis) rerun on both providers before any prompt or model change
- [ ] Memory and soak runs on the 8GB Mac, including analysis and a graded export
- [ ] Release notes and the DMG, version 1.1.0

Exit: the user makes a week of reels with it. Phase 3 does not start before this.

## Risks

| Risk | Likelihood | Impact | Mitigation | Decided at |
| --- | --- | --- | --- | --- |
| LUT effect is too slow or too heavy on 8GB, or export differs | Medium | High | S1 with two fallbacks | Spike |
| Bengali transcription is poor or does not fit in memory | High | High | S2 tests three candidates and picks per job; cloud transcription or hand captions as fallbacks | Spike |
| The cloud transcription model gives no word timings, or is retired (one source dates `whisper-1`'s shutdown to Feb 2027) | Medium | Medium | S2 checks; local alignment as the fallback; the engine sits behind one interface so it can be swapped | Spike, M10 |
| Reels are bland or pick the wrong moments | Medium | High | S3 before any UI; a compiler that enforces cut points and pacing whatever the model says | Spike, Gate 3 |
| Scope: four formats, five styles, LUTs, captions and a music library in one phase | Medium | Medium | The chat editor is moved to Phase 3 and How-to after 1.1.0; formats and styles share the analysis, planner and compiler | M12 |
| Regenerating loses the user's hand edits | Medium | Medium | A regenerated reel is always a new version; the old one is kept | M12 |
| Two providers behave differently on images and structured replies | Medium | Medium | One interface, the fixture provider, the evaluation set run on both | M9, M13 |
| Cost surprises the user | Low | Medium | Frames kept small and few, usage shown per job, optional cap | M9 |
| Static reframing cuts off a moving subject | Medium | Medium | Stated limit; the user drags the picture on the canvas; keyframes are a later phase | M12 |
| A library track gets a reel flagged or muted by the platform | Medium | Medium | Commercial-use licences only, the credit line shown, the limit stated in the app | S6, M12 |
| Phase 1 was never proven on real footage | High | High | Run Gate 2 during the spikes, before M10 | Before M10 |

## Open questions

Nothing is left for the user to answer.

Settled by the spikes, not by the user:

- [ ] **OpenAI default model:** chosen in S3.
- [ ] **Two keys?** Anthropic has no transcription API, so cloud transcription needs an OpenAI key even if planning uses Anthropic. Using OpenAI for both avoids a second key; keeping Anthropic for planning means Settings holds one key per provider. Decided after S2 and S3.
- [ ] **Music service:** chosen in S6.

Decided on Nov 14 (recorded under Decisions taken): the plan approved; V1 ships as 1.0.0 when Gate 2 passes, this phase as 1.1.0; test footage as listed in the appendix; format × style; Gate 2 during the spikes; M8 after this phase; Bengali first, English second, no Hindi (English-only captions rejected, since the user's speech is Bengali); OpenAI transcription as the Bengali fallback with consent per job; transcription chosen per job; a free music library plus the user's own tracks; formats Talk, Highlights, Showcase and Montage in 1.1.0 with How-to after; Talk cutaways in M12; no server; S4 must give a beat grid with strengths.

## Appendix: test footage

What the spikes and gates are tested on. All of it lives outside the repo (for example `~/StudioFootage/<ID>/`) and is never committed. Shot on the user's iPhone with normal settings, HDR on. Round 1 is needed before M10; round 2 is fresh footage for Gate 3, so the final test is not run on the clips the prompts were tuned on.

### Round 1: before M10

| ID | What | Length | Must include | Used by |
| --- | --- | --- | --- | --- |
| G2 | The user's normal vlog material: 10 clips they would cut into a 2 to 3 minute vlog | 10 clips, 5 to 6 min in total | A portrait clip, a 60fps clip, a file named in Bengali, one continuous take of 5+ min with the user talking on camera (lip sync at 0:30, 2:30, 4:50) | Gate 2 |
| TALK-1 | One person talking to camera in Bengali, as they normally talk, English words and pauses included. Portrait, phone on a stand, indoors, quiet room | 10 min | A story with a beginning and an end; at least one strong line that would make a hook | S2, S3 (Talk), M10 exit |
| TALK-1-B | B-roll of things mentioned in TALK-1 | 6 to 10 clips, 5 to 20s each | | S3 (Talk cutaways) |
| ENG-1 | The user talking in English, any topic | 2 to 3 min | | S2 (English) |
| Transcripts | The exact words of 2 min of TALK-1 and 2 min of ENG-1 | 4 min of text | Corrected by the user from a machine draft, word for word | S2 scoring |
| HL-1 | One real event: a gathering, an outing, a match, a class. A long take or many clips | 20 to 40 min | 5+ clear peaks (laughter, cheering, a goal); 2 to 3 sound moments worth keeping; boring stretches to skip; 3+ clips at 60fps | S3 (Highlights), S4 |
| SC-1 | One subject: a product, a dish, a room | 15 to 25 clips, 5 to 15s each | Hero (3 to 4: whole, centred, well lit, still); details (6 to 8 close-ups); in use or moving (4 to 6, two at 60fps); deliberately bad (one dark, one out of focus, one half out of frame); a colour reference (the subject in daylight beside a colour chart, or white paper and pure red, green and blue objects); the subject's name and price | S3 (Showcase), S1, the hue-preserving check |
| MO-1 | B-roll of one place or day out, no talking needed | 25 to 40 clips, 5 to 20s each | Wide and close; daylight, golden hour, night, indoors; steady and shaky; 4 to 5 at 60fps; 3+ with faces in daylight | S3 (Montage), S1, S4 |
| M-1 | Slow, calm track, about 70 to 90 beats per minute | Full song, 2 to 4 min | Music the user has the right to use | S4, beat-cut reels |
| M-2 | Medium track, about 100 to 120 beats per minute | Full song | Clear drum hits | S4, beat-cut reels |
| M-3 | Fast track, about 128 to 150 beats per minute | Full song | Strong drums and at least one drop (accents) | S4, beat-cut reels |
| M-4 | Piano or ambient, weak or no drums | Full song | The hard case for beat detection | S4 |
| BIG | One clip in 4K at 60fps | 5 to 6 min, about 2GB | | S5 |

At least one music track is an ordinary 44.1 kHz MP3, which also covers Gate 2's mixed-sample-rate check. S1 and S4 need no extra shooting: they use MO-1, SC-1 and HL-1 clips and the four tracks.

### Round 2: before the end of M12, for Gate 3

The same shapes with a different topic, place or subject: **TALK-2** (Bengali, outdoors or with background noise, and landscape this time, to test reframing; with its own B-roll), **HL-2** (another event), **SC-2** (another subject), **MO-2** (another place). The music tracks can be reused.

### Order and stock

G2, TALK-1 and ENG-1 first, since Gate 2 and S2 start first; then SC-1, MO-1, HL-1 and the music. Licensed stock can stand in for Montage B-roll; it rarely works for Highlights, and it cannot replace TALK-1, which must be the user's own Bengali speech.
