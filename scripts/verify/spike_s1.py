"""Spike S1: a LUT look as a WebGL2 effect on <Video>. Three 1080p layers, each graded teal-orange at 70%, play in the Player
in the real app, then export at 1080p. Measures graded frames per second and memory while playing, and compares five
golden frames preview vs export (the e2e_m6 method). Synthetic clips, dev Mac only: the memory bar is for the 8GB Mac.
Usage: python3 spike_s1.py <results.json>"""
import subprocess, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, ffprobe, make_fixtures

out_json = Path(sys.argv[1])
C = Checks("S1")
work = Path(tempfile.mkdtemp(prefix="studio-s1-"))
fx = make_fixtures(work / "fixtures")
app = App(work / "projects", work, electron_args=["--force-color-profile=srgb"])
outdir = work / "out"
outdir.mkdir()
HEAD_H = 36


def wait_until(fn, timeout=30, every=0.2):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
        except Exception:
            v = None
        if v:
            return v
        time.sleep(every)
    return None


def raw(args, png=None):
    cmd = ["ffmpeg", "-v", "error", *args, "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    return list(subprocess.run(cmd, input=png, capture_output=True).stdout)


diff = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / max(1, len(a))

try:
    page = app.start().page
    page.set_viewport_size({"width": 1440, "height": 900})
    mem = MemorySampler(page)
    errors, console = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(m.text))
    proj = lambda: page.evaluate("() => window.__e2e.project()")
    dispatch = lambda cmd: page.evaluate("(c) => window.__e2e.dispatch(c)", cmd)
    playing = lambda: page.get_attribute("[data-testid=play]", "aria-pressed") == "true"

    page.click("text=New project")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    names = ["land1080-30", "land1080-30b", "land1080-60"]
    app.pick([fx["clips"][n] for n in names])
    page.click("button:has-text('Import media')")
    C.check("Three 1080p clips imported with proxies", bool(wait_until(lambda: len(proj()["assets"]) == 3 and all(a.get("proxyPath") for a in proj()["assets"]), 240)))

    # three layers: one clip per video track, all from frame 0; the upper two shrunk and offset so all three show
    for i, a in enumerate(proj()["assets"]):
        dispatch({"type": "addTrack", "trackId": f"v{i}", "kind": "video", "index": 0})
        dispatch({"type": "addAsset", "assetId": a["id"], "clipId": f"c{i}", "trackId": f"v{i}"})
    for i in range(3):
        clip = next(c for t in proj()["tracks"] for c in t["clips"] if c["id"] == f"c{i}")
        dispatch({"type": "moveClips", "clipIds": [f"c{i}"], "deltaFrames": -clip["startFrame"], "toTrackId": f"v{i}"})
    dispatch({"type": "updateClip", "clipId": "c1", "patch": {"transform": {"scale": 0.5, "x": -480, "y": -270}}})
    dispatch({"type": "updateClip", "clipId": "c2", "patch": {"transform": {"scale": 0.5, "x": 480, "y": 270}}})
    p = proj()
    layers = [(t["id"], [c["startFrame"] for c in t["clips"]]) for t in p["tracks"] if t["clips"]]
    C.check("Three video layers start at frame 0", len(layers) == 3 and all(s == [0] for _, s in layers), layers)
    total = max(c["startFrame"] + c["durationInFrames"] for t in p["tracks"] for c in t["clips"])
    fps = p["fps"]

    # ---- the effect runs in this Electron (Chrome 148)
    page.mouse.click(700, 20)
    page.keyboard.press("Home")
    C.check("The LUT effect draws in the Player", bool(wait_until(lambda: page.evaluate("() => window.__lutApplies || 0") > 0, 20)), page.evaluate("() => window.__lutApplies || 0"))

    # ---- playing: graded frames per second and memory
    PLAY_S = 5
    page.keyboard.press("Space")
    wait_until(playing, 5)
    page.wait_for_timeout(500)  # past start-up
    n0, t0 = page.evaluate("() => [window.__lutApplies || 0, performance.now()]")
    for _ in range(PLAY_S * 2):
        mem.sample()
        page.wait_for_timeout(500)
    n1, t1 = page.evaluate("() => [window.__lutApplies || 0, performance.now()]")
    page.keyboard.press("Space")
    wait_until(lambda: not playing(), 5)
    graded_fps = round((n1 - n0) / 3 / ((t1 - t0) / 1000), 1)
    C.metrics["graded_fps_per_layer"] = graded_fps
    C.check("Plays three graded layers at 30fps (frames graded per layer per second, dev Mac)", graded_fps >= 29, graded_fps)
    play_mem = mem.summary()
    C.metrics["memory_playing"] = play_mem
    editor_mb = play_mem.get("peak_single_tab_mb", 0)
    C.check("Editor under 600MB while playing (indicative: dev Mac, the bar is measured on the 8GB Mac)", 0 < editor_mb < 600, play_mem)

    # ---- export at 1080p
    page.click("[data-testid=export-open]")
    page.wait_for_selector("[role=dialog][aria-labelledby=export-title]")
    dest = outdir / "s1.mp4"
    app.save_to(dest)
    page.click("[aria-label=Size] button:has-text('1080p')")
    page.click("[data-testid=export-start]")
    t0 = time.time()
    res = wait_until(lambda: next((k for k in ("done", "failed") if page.locator(f"[data-testid=export-{k}]").count()), None) or (mem.sample() and None), 600, 0.5)
    took = time.time() - t0
    C.check("The 1080p export finishes", res == "done" and dest.exists(), f"{res} in {took:.1f}s" + (f": {page.inner_text('[data-testid=export-failed]')[:300]}" if res == "failed" else ""))
    C.metrics["export_1080p_seconds"] = round(took, 1)
    C.metrics["export_realtime_factor"] = round(took / (total / fps), 2)
    C.metrics["memory_with_export"] = mem.summary()
    page.keyboard.press("Escape")

    # ---- golden frames: preview vs export, and both differ from the ungraded source (the look is really applied)
    page.mouse.click(700, 20)
    diffs, graded = [], []
    src = fx["clips"]["land1080-30"]
    for frac in (0.1, 0.3, 0.5, 0.7, 0.9):
        f = int(total * frac)
        page.keyboard.press("Home")
        for _ in range(f):
            page.keyboard.press("ArrowRight")
        page.wait_for_timeout(1200)
        page.mouse.move(1430, 890)
        png = page.locator("[data-testid=preview]").screenshot()
        (work / f"golden-preview-{f}.png").write_bytes(png)
        prev = raw(["-i", "pipe:0"], png)
        exp = raw(["-ss", f"{f / fps:.4f}", "-i", str(dest), "-frames:v", "1"])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{f / fps:.4f}", "-i", str(dest), "-frames:v", "1", str(work / f"golden-export-{f}.png")])
        diffs.append(round(diff(prev, exp), 2) if len(prev) == len(exp) > 0 else 999)
        # bottom layer only shows in the top-right and bottom-left quarters; compare the bottom-left quarter to the source
        quarter = lambda px: [px[(y * 160 + x) * 3 + k] for y in range(50, 85) for x in range(5, 75) for k in range(3)]
        orig = raw(["-ss", f"{f / 30:.4f}", "-i", str(src), "-frames:v", "1"])
        luma = lambda px: sum(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] for i in range(0, len(px), 3)) / max(1, len(px) // 3)
        graded.append((round(diff(quarter(exp), quarter(orig)), 2), round(luma(quarter(exp)) / max(1, luma(quarter(orig))), 2)) if len(orig) == len(exp) else (999, 0))
    C.metrics["golden_frame_diffs"] = diffs
    C.metrics["graded_vs_source_diffs"] = graded
    C.check("Golden frames: export matches preview at five frames (mean difference under 12 of 255)", all(d < 12 for d in diffs), diffs)
    # an empty LUT grades to black, which also differs from the source; teal-orange keeps mean luma within 15%
    C.check("The look is applied in the export: the bottom layer differs from its source by over 8 of 255 at a similar brightness", all(8 < d < 999 and 0.85 < r < 1.15 for d, r in graded), graded)

    C.check("No uncaught errors in the page", not errors, errors[:3])
    C.check("No WebGL or effect errors in the console", not [c for c in console if "webgl" in c.lower() or "effect" in c.lower() or "LUT" in c], [c[:200] for c in console if "webgl" in c.lower() or "effect" in c.lower()][:3])
except Exception:
    import traceback
    C.check("Run completed without crashing", False, traceback.format_exc()[-900:])
finally:
    C.notes.append(f"workdir {work}")
    try:
        app.stop()
    finally:
        C.save(out_json)
        sys.exit(0 if all(i["ok"] for i in C.items) else 1)
