# Phase 2 spike results

Each spike is tested against its row in `docs/phase2-plan.md` ("Spikes first"). Rule as in Phase 0: figures, not impressions.

## S1: a LUT as a WebGL2 effect on `<Video>`

Result: **pass on the dev Mac (24GB), Nov 14 2026. The memory bar is still to be measured on the 8GB Mac.** No fallback taken.

How it was run: branch `spike/s1-lut`, `python3 scripts/verify/spike_s1.py <results.json>`. Three 1080p synthetic clips (`testsrc2` from `make_fixtures`) on three video tracks, all from frame 0, the top two at half size so all three show; every layer graded `teal-orange` at 70%. The app runs with `STUDIO_E2E=1` and `--force-color-profile=srgb`. The real footage (MO-1, SC-1) is not shot yet.

| Bar (S1 row) | Measured | Verdict |
| --- | --- | --- |
| 30fps with three graded layers | 30.0 graded frames per layer per second over 5s of playback (count of effect `apply` calls / 3) | pass |
| Editor under 600MB | editor tab peak 327MB, total 984MB while playing (dev Mac only) | pass here, re-measure on 8GB |
| Export matches preview at five golden frames | mean difference 6.4, 6.8, 6.5, 6.6, 7.2 of 255 (bar 12; M6's ungraded baseline is 4.6 to 5.7) | pass |

Other figures: the 6s 1080p export took 2.1s (0.35x realtime), total memory peak 1055MB with the export window open. No page errors and no WebGL errors in the console.

What the effect is (`apps/desktop/src/engine/lut-effect.ts`): `createEffect` with `backend: "webgl2"`. `setup` gets Remotion's pooled canvas, takes its WebGL2 context and compiles one program. `apply` uploads the source frame as a 2D texture, samples a 33³ `RGB16F` 3D texture (the LUT, generated on first use and cached per `lutId`), mixes by `intensity` and writes premultiplied output. `@remotion/media`'s `<Video>` takes `effects`, and `renderMediaOnWeb` runs the same chain, so preview and export share one code path. It runs in Electron's Chrome 148 (the Chrome 149 limit is for shader transitions only).

Findings:

- **Remotion leaves `UNPACK_PREMULTIPLY_ALPHA_WEBGL` on in the shared WebGL context**, and `texImage3D` refuses it (`INVALID_OPERATION`). The 3D texture is then empty and every pixel grades toward black. The page shows no error, only a console warning. The effect sets both unpack flags off before the LUT upload; M11 keeps that line and a console check.
- **The GPU output matches the generator within 1/255.** Flat bars in the export against `mix(src, sampleLut(src), 0.7)` from `packages/schema/src/lut.ts`: red (234,25,10) vs (233,24,10), green (11,220,6) vs (11,221,5), yellow (255,237,2) vs (255,237,2).
- **The browser decodes the untagged fixtures differently from ffmpeg** (BT.709 against BT.601 for untagged HD): pure green decodes as (0,217,0) in the app and (0,255,1) in ffmpeg. This affects any comparison between ffmpeg-decoded sources and app output, with or without a look, and not preview against export. Real phone footage is tagged, so check this on MO-1.
- **The plan's `-true` recipe failed its own 2° hue check:** a per-channel tone curve shifts hue up to 3.4° (`punch`) on a ColorChecker chart. The variant now curves each colour's largest and smallest channel and places the middle one by ratio, which keeps HSV hue exact. The plan's Looks section is updated to match.

Generator (`packages/schema/src/lut.ts`, 7 vitests): the 6-step recipe, the four looks and their `-true` variants, trilinear `sampleLut`, `.cube` writer. Identity parameters give an identity LUT within 1/255; every `-true` variant keeps all 18 chromatic ColorChecker patches within 2°. Skin protect uses a 0.05 soft edge on saturation as well as the plan's 10° on hue, so the LUT has no hard step.

Still to do for S1:

- Run `spike_s1.py` on the 8GB Mac for the memory bar.
- Once MO-1 and SC-1 are shot, repeat on real clips (the fps and memory figures above come from synthetic 1080p H.264).

Spike-only shortcuts to remove in M11: every video layer gets the look unconditionally (`spikeLook()` in `ProjectComposition.tsx`), and the effect counts its calls in `window.__lutApplies`.
