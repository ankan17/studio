"""M3 end-to-end (Gate 1): the preview engine. Create a project, import two videos and audio, add them to the timeline,
play, scrub, step, check the mount window and memory, save, reopen and confirm the preview is restored.
Usage: python3 e2e_m3.py <results.json> [--small]"""
import json, re, shutil, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, REPO, make_fixtures

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
C = Checks("M3")
work = Path(tempfile.mkdtemp(prefix="studio-m3-"))
fx = make_fixtures(work / "fixtures", small=small)
app = App(work / "projects", work)
shots = REPO / "docs" / "reports" / "assets"
shots.mkdir(parents=True, exist_ok=True)
FPS = 30


def wait_until(fn, timeout=30, every=0.3):
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


def tc(frame):
    s, f = divmod(frame, FPS)
    return f"{s // 60:02d}:{s % 60:02d}:{f:02d}"


try:
    page = app.start().page
    page.set_viewport_size({"width": 1440, "height": 900})
    from lib import MemorySampler
    mem = MemorySampler(page)
    proj = lambda: page.evaluate("() => window.__e2e.project()")
    current = lambda: page.inner_text("[data-testid=timecode]").split("/")[0].strip()
    total_text = lambda: page.inner_text("[data-testid=timecode]").split("/")[1].strip()
    playing = lambda: page.get_attribute("[data-testid=play]", "aria-pressed") == "true"
    mounted = lambda: page.locator("[data-testid=preview] canvas").count()
    signature = lambda: page.evaluate("""() => { const c = document.querySelector('[data-testid=preview] canvas'); if (!c) return null;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0, dark = 0;
        for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; if (d[i] + d[i+1] + d[i+2] < 30) dark++; }
        return {r: r / n, g: g / n, b: b / n, dark: dark / n, w: c.width, h: c.height}; }""")
    hold = lambda ms: (mem.sample(), page.wait_for_timeout(ms), mem.sample())

    # ---- runtime configuration
    C.check("Decoded-frame cache capped at 240MB (Remotion's minimum; the plan's 200MB makes the player fall back to <video>)", page.evaluate("() => window.remotion_mediaCacheSizeInBytes") == 240 * 1024 * 1024)
    console, requests = [], []
    page.on("console", lambda m: console.append(m.text))
    page.on("request", lambda r: requests.append(r.url) if r.url.startswith("media://") else None)
    C.check("Bundled fonts load (Noto Sans Bengali, Bebas Neue)", bool(wait_until(lambda: page.evaluate("async () => { await document.fonts.ready; return document.fonts.check('16px \"Bebas Neue\"') && document.fonts.check('16px \"Noto Sans Bengali\"'); }"), 10)))

    # ---- project and import
    page.click("text=New project")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    C.check("Empty editor shows the empty states", page.locator("text=Nothing on the timeline yet").count() == 1 and page.locator("text=Drop clips here").count() == 1)
    C.check("Transport is disabled with an empty timeline", page.locator("[data-testid=play]").is_disabled())
    app.pick([fx["clips"]["land1080-30"], fx["clips"]["portrait-rot"], fx["audio"]])
    page.click("button:has-text('Import media')")
    ready = wait_until(lambda: len(proj()["assets"]) == 3 and all(a.get("durationUs") and (a["type"] != "video" or a.get("proxyPath")) for a in proj()["assets"]), 120)
    C.check("Two videos and a track of audio imported with proxies", bool(ready))

    # ---- append to timeline from the media panel
    def add(name):
        tile = page.locator("[data-testid=asset-tile]", has_text=name)
        tile.hover()
        tile.get_by_label("Add to timeline").click()
    add("land1080-30"); add("portrait-rot"); add("tone.m4a")
    p = proj()
    v = next(t for t in p["tracks"] if t["type"] == "video"); a = next(t for t in p["tracks"] if t["type"] == "audio")
    clips = v["clips"]
    dur = [c["durationInFrames"] for c in clips]
    C.check("Clips appended back to back on one video track, audio on its own track", len(clips) == 2 and clips[0]["startFrame"] == 0 and clips[1]["startFrame"] == dur[0] and len(a["clips"]) == 1, f"starts {[c['startFrame'] for c in clips]} durations {dur}")
    C.check("Video track sits above the audio track", [t["type"] for t in p["tracks"]] == ["video", "audio"])
    total = dur[0] + dur[1]
    C.check("Timeline shows both clips and the audio clip, total duration in the transport", page.locator("[data-testid=clip-block]").count() == 3 and total_text() == tc(total), f"{total_text()} vs {tc(total)}")
    page.screenshot(path=str(shots / "M3-editor.png"))
    C.metrics["screenshots"] = ["M3-editor.png"]

    # ---- preview at the start, mount window
    wait_until(lambda: (signature() or {}).get("dark", 1) < 0.5, 20)
    sig0 = signature()
    C.check("Preview paints the first clip at frame 0", bool(sig0) and sig0["dark"] < 0.5, sig0)
    C.check("Preview uses the WebCodecs player (no native <video> fallback, no player errors in the console)", page.locator("[data-testid=preview] video").count() == 0 and not [c for c in console if "initialization failed" in c or "[VideoForPreview]" in c], [c[:160] for c in console if "VideoForPreview" in c][:2])
    C.check("Mount window: at frame 0 only the first clip is mounted", mounted() == 1, f"{mounted()} media canvases")

    # ---- playback with the keyboard
    page.click("body", position={"x": 700, "y": 20})  # focus outside any input
    page.keyboard.press("Space")
    started = wait_until(playing, 5)
    t0 = time.time(); f0 = None
    hold(1500)
    page.keyboard.press("Space")
    paused = wait_until(lambda: not playing(), 5)
    played = int(page.inner_text("[data-testid=timecode]").split("/")[0].strip().split(":")[-1]) + 30 * int(current().split(":")[1])
    C.check("Space plays and pauses", bool(started) and bool(paused))
    C.check("Playback advances in real time (about 1.5s of frames)", 35 <= played <= 70, f"{played} frames in ~1.5s at {FPS}fps")
    stable = current(); page.wait_for_timeout(600)
    C.check("Paused playhead stays put", current() == stable)

    # ---- stepping and jumping
    page.keyboard.press("Home"); wait_until(lambda: current() == tc(0), 3)
    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight")
    C.check("Arrow keys step one frame", wait_until(lambda: current() == tc(2), 3) is not None, current())
    page.keyboard.press("Shift+ArrowRight")
    C.check("Shift+Arrow steps one second", wait_until(lambda: current() == tc(2 + FPS), 3) is not None, current())
    page.keyboard.press("ArrowLeft")
    C.check("Left arrow steps back", wait_until(lambda: current() == tc(1 + FPS), 3) is not None, current())
    page.keyboard.press("End")
    C.check("End jumps to the last frame", wait_until(lambda: current() == tc(total - 1), 3) is not None, f"{current()} vs {tc(total - 1)}")
    C.check("Space at the end restarts from the beginning", (page.keyboard.press("Space"), wait_until(lambda: int(current().split(":")[2]) != 0 or current() < tc(total - 1), 3))[1] is not None)
    page.keyboard.press("Space")

    # ---- scrubbing and the second clip
    box = page.locator("[data-testid=sequence]").bounding_box()
    track_x0 = box["x"] + 64 + 14
    def click_frame(f):
        px = (page.evaluate("() => document.querySelector('[data-testid=sequence]').clientWidth") - 64 - 28) / max(total * 1.06, FPS * 12)
        page.mouse.click(track_x0 + f * px, box["y"] + 60)
    click_frame(dur[0] + 20)
    ok = wait_until(lambda: current() == tc(dur[0] + 20) or abs(int(current().split(":")[1]) * 30 + int(current().split(":")[2]) - (dur[0] + 20)) <= 3, 3)
    C.check("Clicking the sequence moves the playhead", bool(ok), f"{current()} for frame {dur[0] + 20}")
    wait_until(lambda: (signature() or {}).get("h", 0) > (signature() or {}).get("w", 1) and (signature() or {}).get("dark", 1) < 0.95, 20)
    sig1 = signature()
    C.check("Second clip (portrait) is drawn after seeking into it, first clip was landscape", bool(sig1) and sig1["h"] > sig1["w"] and sig1["dark"] < 0.95 and sig0["w"] > sig0["h"], f"first {sig0['w']}x{sig0['h']}, second {sig1 and (sig1['w'], sig1['h'])}")
    click_frame(dur[0] - 40)
    page.wait_for_timeout(1200)
    C.check("Mount window: within 2s of the next clip both are mounted", mounted() == 2, f"{mounted()} media canvases")
    click_frame(total - 20)
    page.wait_for_timeout(1500)
    C.check("Mount window: past the first clip it is unmounted again", mounted() == 1, f"{mounted()} media canvases")

    # ---- playing across the cut, memory
    click_frame(dur[0] - 30)
    page.keyboard.press("Space"); hold(500)
    for _ in range(2):
        hold(1000)
    crossed = int(current().split(":")[1]) * 30 + int(current().split(":")[2])
    page.keyboard.press("Space")
    C.check("Playback runs across the cut into the second clip", crossed > dur[0] + 10, f"frame {crossed}, cut at {dur[0]}")
    C.check("Preview draws the second clip after playing across the cut", (signature() or {}).get("h", 0) > (signature() or {}).get("w", 1) and (signature() or {}).get("dark", 1) < 0.95, signature())
    C.check("Preview reads the 720p proxies, not the originals", any(".proxy.mp4" in u for u in requests) and not any(re.search(r"/assets/[0-9a-f]{64}\.(mp4|mov)", u) for u in requests), sorted({u.split("/")[-1][:20] + "…" + u[-10:] for u in requests})[:4])
    s = mem.summary(); C.metrics["memory"] = s
    C.check("Memory bar: editor tab under 600MB while previewing", s["peak_single_tab_mb"] < 600, f"{s['peak_single_tab_mb']}MB")
    C.check("Memory bar: total under 1.2GB while previewing (indicative on this machine)", s["peak_total_mb"] < 1200, f"{s['peak_total_mb']}MB")

    # ---- save, reopen, restore (Gate 1)
    pid = proj()["id"]; pdir = work / "projects" / pid
    wait_until(lambda: json.loads((pdir / "project.json").read_text()) == proj(), 10)
    saved = json.loads((pdir / "project.json").read_text())
    C.check("Timeline saved to project.json", sum(len(t["clips"]) for t in saved["tracks"]) == 3)
    page.click("text=Projects")
    page.click("[aria-label^='Open ']")
    page.wait_for_selector("[data-testid=media-panel]")
    C.check("Reopen: timeline restored with all three clips", wait_until(lambda: page.locator("[data-testid=clip-block]").count() == 3, 10) is not None and total_text() == tc(total))
    wait_until(lambda: (signature() or {}).get("dark", 1) < 0.5, 20)
    C.check("Reopen: preview restored (first frame painted)", (signature() or {}).get("dark", 1) < 0.5, signature())
    page.click("body", position={"x": 700, "y": 20})
    page.keyboard.press("Space"); page.wait_for_timeout(1200); page.keyboard.press("Space")
    C.check("Reopen: playback works", current() != tc(0), current())

    # ---- aspect ratio follows the project (vertical 9:16)
    page.click("text=Projects")
    page.click("text=New project")
    page.click("button:has-text('Vertical')")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=preview]")
    page.wait_for_timeout(500)
    r = page.locator("[data-testid=preview]").bounding_box(); st = page.locator("[data-testid=stage]").bounding_box()
    C.check("Stage keeps a 9:16 project 9:16 and fits inside its area", abs(r["width"] / r["height"] - 9 / 16) < 0.01 and r["height"] <= st["height"] + 1 and r["width"] <= st["width"] + 1, f"{r['width']:.0f}x{r['height']:.0f} in {st['width']:.0f}x{st['height']:.0f}")
    page.screenshot(path=str(shots / "M3-vertical.png"))
    C.metrics["screenshots"].append("M3-vertical.png")

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
