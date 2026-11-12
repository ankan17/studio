"""M6 end-to-end: export. A small vlog (clips, a dissolve, a title, music) is exported from the real app with the web
renderer in the hidden render window. Checks: the export dialog and versioned names, progress and time estimate,
cancel (no file kept), refused destinations, the MP4 itself (size, fps, codecs, duration, audio and video lengths),
five golden frames against the preview, export history and per-export logs in the project folder, and that the render
window's memory is returned afterwards. The 5-minute exit (Gate 2) is run by hand on real footage: see M6.notes.md.
Usage: python3 e2e_m6.py <results.json> [--small]"""
import json, subprocess, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, REPO, ffprobe, make_fixtures, sh

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
C = Checks("M6")
work = Path(tempfile.mkdtemp(prefix="studio-m6-"))
fx = make_fixtures(work / "fixtures", small=small)
app = App(work / "projects", work)
shots = REPO / "docs" / "reports" / "assets"
shots.mkdir(parents=True, exist_ok=True)
outdir = work / "out"
outdir.mkdir()
HEAD_H, RULER_H = 36, 26  # Timeline.tsx geometry


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


def raw_frame(png):
    """160x90 RGB bytes from a PNG."""
    cmd = ["ffmpeg", "-v", "error", "-i", "pipe:0", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    return list(subprocess.run(cmd, input=png, capture_output=True).stdout)


diff = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / max(1, len(a))

try:
    page = app.start().page
    page.set_viewport_size({"width": 1440, "height": 900})
    mem = MemorySampler(page)
    C.metrics["screenshots"] = []
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    proj = lambda: page.evaluate("() => window.__e2e.project()")
    dispatch = lambda cmd: page.evaluate("(c) => window.__e2e.dispatch(c)", cmd)

    def shot(name):
        page.mouse.move(1430, 890)
        page.wait_for_timeout(300)
        page.screenshot(path=str(shots / f"M6-{name}.png"))
        C.metrics["screenshots"].append(f"M6-{name}.png")

    def geom():
        return page.evaluate("""() => { const s = document.querySelector('[data-testid=sequence]'); const r = s.getBoundingClientRect();
            return {x: r.left, y: r.top, ppf: +s.dataset.ppf, sx: +s.dataset.scrollX, lane: +s.dataset.laneLeft, pad: +s.dataset.pad}; }""")

    def ph_frame():
        mm, ss, ff = (int(x) for x in page.inner_text("[data-testid=playhead]").strip().split(":"))
        return (mm * 60 + ss) * 30 + ff

    def goto(f):
        g = geom()
        page.mouse.click(g["x"] + g["lane"] + g["pad"] + f * g["ppf"] - g["sx"], g["y"] + HEAD_H + 13)
        for _ in range(60):
            cur = ph_frame()
            if cur == f:
                break
            page.keyboard.press("ArrowRight" if cur < f else "ArrowLeft")
        page.wait_for_timeout(900)
        return ph_frame() == f

    def preview_frame():
        page.keyboard.press("Escape")
        page.mouse.move(1430, 890)
        page.wait_for_timeout(150)
        return raw_frame(page.locator("[data-testid=preview]").screenshot())

    def tab_count():
        mem.sample()
        return len([k for k in (mem.samples[-1]["procs"] if mem.samples else {}) if k.startswith("Tab")])

    def open_dialog():
        page.click("[data-testid=export-open]")
        page.wait_for_selector("[role=dialog][aria-labelledby=export-title]")

    def close_dialog():
        page.keyboard.press("Escape")
        page.wait_for_selector("[role=dialog][aria-labelledby=export-title]", state="detached")

    def export_once(dest, height_label, cancel_when_running=False, timeout=240):
        """Start an export from the open dialog. Returns 'done', 'cancelled', 'failed' or 'error' (could not start), plus samples."""
        app.save_to(dest)
        page.click(f"[aria-label=Size] button:has-text('{height_label}')")
        page.click("[data-testid=export-start]")
        percents, etas = [], []
        end = time.time() + timeout
        while time.time() < end:
            if page.locator("[data-testid=export-start-error]").count():
                return "error", percents, etas
            for k in ("done", "cancelled", "failed"):
                if page.locator(f"[data-testid=export-{k}]").count():
                    return k, percents, etas
            if page.locator("[data-testid=export-running]").count():
                if cancel_when_running:
                    page.click("button:has-text('Cancel export')")
                    cancel_when_running = False
                try:
                    percents.append(int(page.inner_text("[data-testid=export-percent]").strip("%")))
                    etas.append(page.inner_text("[data-testid=export-running] .num.text-caption"))
                except Exception:
                    pass
            mem.sample()
            time.sleep(0.25)
        return "timeout", percents, etas

    # ---- an empty project cannot be exported
    page.click("text=New project")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    C.check("Export is disabled while the timeline is empty", page.locator("[data-testid=export-open]").is_disabled())

    # ---- a small vlog: two clips with a dissolve, a title, music
    names = ["land1080-30", "land1080-30b", "land720-24"]
    app.pick([*(fx["clips"][n] for n in names), fx["audio"]])
    page.click("button:has-text('Import media')")
    ready = wait_until(lambda: len(proj()["assets"]) == 4 and all((a["type"] == "image" or a.get("durationUs")) and (a["type"] != "video" or a.get("proxyPath")) for a in proj()["assets"]), 240)
    C.check("Three clips and music imported with proxies", bool(ready))
    for n in names:
        tile = page.locator("[data-testid=asset-tile]", has_text=n + ".")
        tile.hover()
        tile.get_by_label("Add to timeline").click()
    tile = page.locator("[data-testid=asset-tile]", has_text="tone.m4a")
    tile.hover()
    tile.get_by_label("Add to timeline").click()
    dispatch({"type": "setProject", "patch": {"name": "Trip: day/1"}})
    v1 = [c["id"] for c in proj()["tracks"][0]["clips"]]
    dispatch({"type": "setTransition", "clipId": v1[0], "transition": {"kind": "fade", "durationInFrames": 20}})
    page.mouse.click(700, 20)
    page.keyboard.press("Home")
    page.keyboard.press("t")
    page.fill("textarea[aria-label='Title text']", "আমার ভ্লগ")
    p = proj()
    total = max(c["startFrame"] + c["durationInFrames"] for t in p["tracks"] for c in t["clips"])
    fps = p["fps"]
    C.check("The vlog has a transition, a Bengali title and music", any(c.get("transitionOut") for c in p["tracks"][0]["clips"]) and any(t["type"] == "text" and t["clips"] for t in p["tracks"]) and any(t["type"] == "audio" and t["clips"] for t in p["tracks"]), f"{total} frames")
    pid = p["id"]
    pdir = work / "projects" / pid

    # ---- the dialog
    page.mouse.click(700, 20)
    open_dialog()
    labels = page.locator("[aria-label=Size] button").all_inner_texts()
    C.check("The dialog offers 1080p and 720p with their pixel sizes", labels == ["1080p · 1920×1080", "720p · 1280×720"], labels)
    shot("dialog")

    # ---- destinations that are refused, and a cancelled save dialog
    app.save_to("")
    page.click("[data-testid=export-start]")
    page.wait_for_timeout(1500)
    C.check("Cancelling the save dialog starts nothing", page.locator("[data-testid=export-running]").count() == 0 and page.locator("[data-testid=export-start-error]").count() == 0)
    C.check("The suggested name is the project name, made safe, plus a version", (work / "save.txt.suggested").read_text() == "Trip day 1 v1.mp4", (work / "save.txt.suggested").read_text())
    res, _, _ = export_once(pdir / "project.json", "720p")
    err = page.inner_text("[data-testid=export-start-error]") if res == "error" else ""
    C.check("A destination inside Studio's project storage is refused", res == "error" and "outside" in err and json.loads((pdir / "project.json").read_text())["id"] == pid, err)
    res, _, _ = export_once(outdir / "no-such-folder" / "x.mp4", "720p")
    C.check("A folder that cannot be written gives a readable error and no export starts", res == "error" and page.locator("[data-testid=export-running]").count() == 0, page.inner_text("[data-testid=export-start-error]") if res == "error" else res)

    # ---- cancel keeps nothing
    base_tabs = tab_count()
    cancel_dest = outdir / "cancelled.mp4"
    res, _, _ = export_once(cancel_dest, "1080p", cancel_when_running=True)
    page.wait_for_timeout(500)
    C.check("Cancel stops the export and keeps no file (not even a partial one)", res == "cancelled" and not cancel_dest.exists() and not Path(str(cancel_dest) + ".part").exists(), f"{res}, files {sorted(p.name for p in outdir.iterdir())}")
    C.check("The render window is gone after a cancel", wait_until(lambda: tab_count() <= base_tabs, 20) is not None, f"{tab_count()} tabs vs {base_tabs} before")

    # ---- a real export at 720p
    dest = outdir / "Trip day 1 v2.mp4"
    t0 = time.time()
    res, percents, etas = export_once(dest, "720p")
    took = time.time() - t0
    C.check("The export finishes", res == "done" and dest.exists(), f"{res} in {took:.1f}s")
    C.check("Progress climbs steadily and a time estimate appears", len(percents) >= 2 and percents == sorted(percents) and any("left" in e for e in etas), f"percents {percents[:6]}..{percents[-3:]}, estimates {etas[:3]}")
    shot("done")
    C.check("The second export is version 2 (the cancelled one counted)", (work / "save.txt.suggested").read_text() == "Trip day 1 v2.mp4", (work / "save.txt.suggested").read_text())
    C.check("No .part file is left beside the export", not Path(str(dest) + ".part").exists())

    # ---- the file itself
    info = ffprobe(dest)
    v = next((s for s in info.get("streams", []) if s["codec_type"] == "video"), {})
    a = next((s for s in info.get("streams", []) if s["codec_type"] == "audio"), {})
    num, den = (v.get("r_frame_rate") or "0/1").split("/")
    C.check("The MP4 is H.264 at 1280x720 and the project's frame rate", v.get("codec_name") == "h264" and (v.get("width"), v.get("height")) == (1280, 720) and abs(int(num) / int(den) - fps) < 0.01, f"{v.get('codec_name')} {v.get('width')}x{v.get('height')} {v.get('r_frame_rate')}")
    C.check("The MP4 has AAC audio", a.get("codec_name") == "aac", a.get("codec_name"))
    want = total / fps
    vd, ad = float(v.get("duration", 0)), float(a.get("duration", 0))
    C.check("Video length matches the timeline", abs(vd - want) < 0.25, f"{vd:.2f}s vs {want:.2f}s")
    C.check("Audio and video end together (sync at the end of the file)", abs(vd - ad) < 0.25, f"video {vd:.2f}s, audio {ad:.2f}s")
    C.metrics["export_720p"] = {"seconds": round(took, 1), "video_seconds": round(want, 1), "realtime_factor": round(took / want, 2), "mb": round(dest.stat().st_size / 1e6, 1)}

    # ---- golden frames: the preview against the export at five frames
    close_dialog()
    page.mouse.click(700, 20)
    diffs = []
    for frac in (0.1, 0.3, 0.5, 0.7, 0.9):
        f = int(total * frac)
        goto(f)
        prev = preview_frame()
        exp = list(subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{f / fps:.4f}", "-i", str(dest), "-frames:v", "1", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], capture_output=True).stdout)
        diffs.append(round(diff(prev, exp), 2) if len(prev) == len(exp) > 0 else 999)
    C.check("Golden frames: the export matches the preview at five frames (mean difference under 12 of 255)", all(d < 12 for d in diffs), diffs)
    C.metrics["golden_frame_diffs"] = diffs

    # ---- history and logs
    hist = json.loads((pdir / "exports.json").read_text())
    C.check("History in the project folder lists the cancelled and the finished export", [(h["version"], h["status"]) for h in hist] == [(1, "cancelled"), (2, "done")] and hist[1]["fileName"] == dest.name and hist[1]["sizeBytes"] == dest.stat().st_size and hist[1]["outputHeight"] == 720, hist)
    logs = [(pdir / "exports" / f"{h['id']}.log") for h in hist]
    C.check("Each export has a log file with its outcome", all(l.exists() and l.stat().st_size > 0 for l in logs) and "done" in logs[1].read_text() and "cancel" in logs[0].read_text().lower(), [l.read_text()[-120:] for l in logs if l.exists()])
    open_dialog()
    C.check("The dialog lists earlier exports", page.locator("[data-testid=export-history] li").count() == 2)
    shot("history")
    close_dialog()
    C.check("Exporting did not change the project file (history is kept apart)", json.loads((pdir / "project.json").read_text()) == proj() and "exports" not in json.loads((pdir / "project.json").read_text()))

    # ---- memory
    peak = mem.summary()
    C.metrics["memory"] = peak
    C.check("Memory during exports: total under 1.5GB (indicative on this machine)", 0 < peak.get("peak_total_mb", 0) < 1500, peak)
    time.sleep(30)
    mem.sample()
    after = mem.samples[-1]["total"] if mem.samples else 0
    C.metrics["total_mb_30s_after_export"] = after
    C.check("Thirty seconds after the export the render window is gone", tab_count() <= base_tabs, f"{tab_count()} tabs vs {base_tabs} before; total {after}MB")

    # ---- end of run
    C.check("No uncaught errors in the page", not page_errors, page_errors[:3])
    log = (work / "app.log").read_text()
    errs = [l for l in log.splitlines() if "Error" in l and "DevTools" not in l and "ExtensionLoadWarning" not in l]
    C.check("No errors in the app log", not errs, errs[:3])
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
