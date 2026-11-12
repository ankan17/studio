# Studio V1 release checklist

The acceptance scenarios from the original spec (section 10 and the "MVP definition of done" in section 12), written as a
checklist to run before a build is called V1. Each row says what is already proven by an automated check (the report that
holds it) and what is left to do **by hand on the 8GB Mac with real phone footage**. Automated runs use synthetic ffmpeg
clips on a bigger dev machine, so they prove behaviour, not the memory budget or real-footage quality.

Tick a row only when you did it on the release build (the DMG, installed), not the dev build.

## A. Spec scenarios

| # | Scenario | Expected | Automated | By hand on the 8GB Mac |
|---|---|---|---|---|
| 1 | Import 10 video files | All appear in the media library | M2 (12 assets, de-duplication, reopen), M4 (10-clip cut) | [ ] import 10 real iPhone clips; all tiles get a picture and a duration |
| 2 | Three video tracks | They render in the correct layer order | M4 (add, reorder, hide and mute tracks). Layer order in a render is not automated: M6's golden frames use one video track and a title | [ ] stack three clips with different sizes on V1, V2, V3; the top track is on top, and an export matches |
| 3 | Trim a clip | Preview and export match | M4 (trim), M6 (golden frames at five frames) | [ ] trim a real clip, export, play the MP4: the same frames |
| 4 | Split a clip | Both halves keep the right source timing | M4 (split, 50 undo and 50 redo steps back to identical projects) | [ ] split a clip with speech; the second half continues without a jump |
| 5 | Add text | Text appears at the right frames | M5 (titles, Bengali, in and out animations), M6 (a Bengali title in the export) | [ ] a Bengali and an English title, check start and end frames in the export |
| 6 | Add background music | Audio is in sync | M5 (music), M6 (export has the audio track) | [ ] **Gate 2:** a 5-minute vlog, music and speech still in sync at the 5-minute mark |
| 7 | Change aspect ratio | The composition adapts | M1 (duplicate, with an fps change; `packages/schema` tests), M5 (fit and crop). Changing the aspect ratio of a duplicate in the UI is not automated | [ ] duplicate a landscape project to 9:16, adjust the layout, export both |
| 8 | Close and reopen the app | The project is restored | M3 and M5 (reopen restores the timeline exactly). A real Cmd+Q and Dock restart is not automated | [ ] quit with Cmd+Q, start again from the Dock, open the project |
| 9 | Force an application crash | The last valid save can be recovered | `packages/project-store` crash test (SIGKILL mid-save, 12 times), **M7** (force-quit mid-edit, crash notice, damaged file restored from a copy; the test also run in `packages/project-store`) | [ ] force quit during an edit (Activity Monitor), reopen: notice shown, work is there |
| 10 | Cancel an export | The worker stops and the project is not corrupted | M6 (cancel keeps no file, render window gone) | [ ] cancel a long export; the project opens and edits as before |
| 11 | Export a 5-minute vlog | The MP4 plays with synchronised audio | M6 (a short vlog; the 5-minute run is not automated) | [ ] **Gate 2:** 5-minute 1080p30 export; peak memory under 1.5GB; check lips against audio at 0:30, 2:30 and 4:50 |

## B. Also test (spec section 10)

| Item | Automated | By hand |
|---|---|---|
| Variable frame rate video | Not automated: the fixtures are constant frame rate. M2 checks that proxies are constant frame rate (60 to 30, 24 kept) | [ ] a real VFR phone clip stays in sync |
| Portrait video | M2 (rotation read, upright proxy and thumbnail), M5 | [ ] a real portrait clip, exported |
| iPhone HDR footage | M2 (HLG HEVC 10-bit through the proxy queue), M6 | [ ] a real HDR clip: the export is not washed out against the phone's own playback |
| Different audio sample rates | Not automated: fixtures mix 44.1 kHz music with 48 kHz clips and export fine (M6), but sync across rates is not measured | [ ] a clip at 44.1 kHz next to one at 48 kHz, in sync |
| Unicode file names and Bengali text | **M7** (a Bengali file name imports and shows), M5 (Bengali titles) | [ ] a clip named in Bengali, a title in Bengali, exported |
| Missing media | M2 (relink), **M7** (banner, playback survives, export names the file, relink, a file lost mid-export) | [ ] move a clip in Finder, reopen: the banner names it; relink fixes it |
| Insufficient disk space | **M7** (real 300MB disk image: import and export refused with a reason, autosave fails then retries) | [ ] with under 2GB free, start a 5-minute export: refused with a reason, nothing half-written |

## C. Journeys (spec section 1.1)

| Journey | Automated | By hand |
|---|---|---|
| A. Create a vlog (new project, format, import, arrange, trim, split, text and music, preview, export) | M5 and M6 together | [ ] the real user makes a 2 to 3 minute vlog from 10 phone clips with no help |
| C. Edit an existing project (open, continue, autosave, export another version) | M3, M5 (reopen restores the project), M6 (versioned exports) | [ ] reopen yesterday's project, change one cut, export v2 |
| D. Multiple versions (duplicate, change the aspect ratio, adjust, export) | `packages/schema` and `packages/project-store` tests (duplicate with a new fps). The UI flow is not automated | [ ] duplicate to 9:16, export both |
| B. Saree reel (Business Studio) | not in V1: M8 | not part of this release |

## D. Release checks (M7)

| Item | Check |
|---|---|
| Installs | [ ] open the DMG, drag Studio to Applications, open it once with right-click, Open (it is unsigned) |
| First run | [ ] the empty dashboard and the empty project explain the first steps; `?` shows the shortcuts |
| Memory | [ ] editor tab under 600MB and total under 1.2GB through a 30-minute editing session (the in-app memory readout); export peak under 1.5GB |
| Updates | [ ] Help, Check for Updates says "up to date" or offers the download page |
| Problem report | [ ] Help, Report a Problem shows version, system and the last log lines, and copies them |
| Quit | [ ] Cmd+Q after an edit: the next start shows no crash notice |
| Uninstall | [ ] drag Studio to the Trash; projects stay in `~/Library/Application Support/Studio/projects` until deleted by hand |

## E. Product checklist (spec section 12)

Project management: create, open, duplicate, delete; save and recover; self-contained projects (media is copied in).
Editing: import video, images and audio; several tracks; drag, trim, split, reorder; text and image overlays; music and transitions; undo and redo.
Preview and export: real-time preview; MP4 in 16:9 and 9:16; 1080p; progress; cancel.
Reliability: autosave; recover from crashes; missing media; original footage is never modified (imports are copies).

The "Automated" columns point at the milestone reports in `docs/reports/`; "not automated" means no check exists yet. The "By hand" column is what the person doing the release still has to see with their own eyes.
