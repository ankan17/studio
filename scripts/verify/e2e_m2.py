"""M2 end-to-end: media import, metadata, proxies, thumbnails, peaks, dedupe, cancel, relink, cleanup, security negatives.
Drives the real Electron app over CDP. Usage: python3 e2e_m2.py <results.json> [--small]"""
import json, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from lib import PORT, App, Checks, MemorySampler, REPO, ffprobe, make_fixtures, sh

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
C = Checks("M2")
work = Path(tempfile.mkdtemp(prefix="studio-m2-"))
projects = work / "projects"
fx = make_fixtures(work / "fixtures", small=small)
app = App(projects, work)
mem = None


def wait_until(fn, timeout=60, every=0.5):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    return None


def proj():
    return page.evaluate("() => window.__e2e.project()")


def settled(p):
    """Every asset has the metadata and derived files the panel needs (proxyPath is set once the worker reports done)."""
    for a in p["assets"]:
        if a["type"] == "video" and not (a.get("proxyPath") and a.get("durationUs")):
            return False
        if a["type"] == "audio" and a.get("durationUs") is None:
            return False
        if a["type"] == "image" and a.get("width") is None:
            return False
    return True


def sample_until(fn, timeout):
    end = time.time() + timeout
    while time.time() < end:
        mem.sample()
        v = fn()
        if v:
            return v
        time.sleep(1)
    return None


try:
    page = app.start().page
    mem = MemorySampler(page)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

    # ---- create a project and open it
    page.click("text=New project")
    page.click("button:has-text('Create')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    C.check("Editor opens with an empty media panel", page.locator("text=Drop clips here").count() == 1)
    pid = proj()["id"]
    pdir = projects / pid

    # ---- import 10 clips + audio + image through the real Import button (dialog stubbed with a file list)
    names = list(fx["clips"])
    app.pick([*fx["clips"].values(), fx["audio"], fx["image"]])
    t0 = time.time()
    page.click("button:has-text('Import media')")
    wait_until(lambda: len(proj()["assets"]) == 12, 30)
    C.check("12 files imported into the manifest", len(proj()["assets"]) == 12, f"{len(proj()['assets'])} assets")
    page.screenshot(path=str(work / "importing.png"))
    done = sample_until(lambda: settled(proj()), 600)
    elapsed = time.time() - t0
    C.check("All proxies, thumbnails and metadata finish", bool(done), f"{elapsed:.1f}s")
    src_seconds = sum(float(ffprobe(p)["format"]["duration"]) for p in fx["clips"].values())
    C.metrics.update({"import_all_seconds": round(elapsed, 1), "source_video_seconds": round(src_seconds, 1), "x_realtime": round(src_seconds / elapsed, 1), "machine_ram_gb": round(int(sh("sysctl", "-n", "hw.memsize").stdout) / 2**30)})
    C.check("Exit bar: 10 clips imported with proxies in under 2 minutes", elapsed < 120, f"{elapsed:.1f}s for {src_seconds:.0f}s of source video (synthetic clips, dev machine; the 8GB Mac needs its own run with real phone clips)")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(work / "panel.png"))

    # ---- manifest metadata
    by_name = {a["name"]: a for a in proj()["assets"]}
    def A(key):
        return by_name[Path(fx["clips"][key]).name]
    p = A("portrait-rot")
    C.check("Portrait source read as displayed 1080x1920 with a 90/270 rotation", (p.get("width"), p.get("height")) == (1080, 1920) and p.get("rotation") in (90, 270), (p.get("width"), p.get("height"), p.get("rotation")))
    C.check("Landscape 4K dimensions and 30fps", (A("land4k-30").get("width"), A("land4k-30").get("height"), round(A("land4k-30").get("fps", 0))) == (3840, 2160, 30))
    C.check("60fps clip reports ~60fps", abs(A("land1080-60").get("fps", 0) - 60) < 1.5, A("land1080-60").get("fps"))
    C.check("Silent clip has 0 audio channels, clips with a (mono) tone have 1", A("silent").get("audioChannels") == 0 and A("land1080-30").get("audioChannels") == 1, f"{A('silent').get('audioChannels')}/{A('land1080-30').get('audioChannels')}")
    C.check("HDR (HLG, HEVC 10-bit) detected; SDR not flagged", A("hevc10-hdr").get("hdr") is True and not A("land1080-30").get("hdr"), f"hdr={A('hevc10-hdr').get('hdr')} codec={A('hevc10-hdr').get('codec')}")
    C.check("Duration within 0.2s of source", abs(A("land1080-30")["durationUs"] / 1e6 - float(ffprobe(fx["clips"]["land1080-30"])["format"]["duration"])) < 0.2)
    aud = by_name["tone.m4a"]
    C.check("Audio asset has duration, no dimensions", aud.get("durationUs", 0) > 3.5e6 and "width" not in aud)
    img = by_name["still.png"]
    C.check("Image asset has dimensions", (img.get("width"), img.get("height")) == (1600, 900))

    # ---- proxies: codec, size, fps
    def video(path):
        return next(s for s in ffprobe(path)["streams"] if s["codec_type"] == "video")
    def fps_of(s):
        a, b = s["avg_frame_rate"].split("/"); return int(a) / int(b)
    expect = {  # key: (width, height, fps)
        "land1080-30": (1280, 720, 30), "land1080-60": (1280, 720, 30), "land720-24": (1280, 720, 24), "land4k-30": (1280, 720, 30),
        "portrait-rot": (720, 1280, 30), "silent": (1280, 720, 30), "hevc10-hdr": (1280, 720, 30), "hevc8": (1280, 720, 30),
    }
    bad = []
    for key, (w, h, f) in expect.items():
        a = A(key)
        path = pdir / a["proxyPath"]
        if not path.exists():
            bad.append(f"{key}: no proxy"); continue
        s = video(path)
        probs = []
        if s["codec_name"] != "h264": probs.append(s["codec_name"])
        if s["pix_fmt"] != "yuv420p": probs.append(s["pix_fmt"])
        if (s["width"], s["height"]) != (w, h): probs.append(f"{s['width']}x{s['height']}")
        if abs(fps_of(s) - f) > 0.5: probs.append(f"fps {fps_of(s):.2f}")
        if s["r_frame_rate"] != s["avg_frame_rate"]: probs.append(f"vfr {s['r_frame_rate']} vs {s['avg_frame_rate']}")
        if probs: bad.append(f"{key}: {', '.join(probs)}")
    C.check("Proxies are H.264 8-bit, 720p short side (portrait 720x1280), constant frame rate (60fps->30, 24 kept)", not bad, "; ".join(bad) or f"{len(expect)} proxies verified with ffprobe")
    C.check("HEVC 10-bit HDR source went through the proxy queue to 8-bit SDR H.264", video(pdir / A("hevc10-hdr")["proxyPath"])["pix_fmt"] == "yuv420p")
    def gray(path, extra=()):
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", "1", "-i", str(path), "-frames:v", "1", *extra, "-vf", "scale=45:80,format=gray", "-f", "rawvideo", "-"], capture_output=True)
        return list(r.stdout)
    ref, prox = gray(fx["clips"]["portrait-rot"]), gray(pdir / A("portrait-rot")["proxyPath"])
    flipped = prox[::-1]  # 180 degrees
    diff = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / max(1, len(a))
    C.check("Portrait proxy is upright (matches the source as Apple displays it, not turned 180 or 90)", len(ref) == len(prox) == 3600 and diff(ref, prox) < 25 and diff(ref, flipped) > diff(ref, prox) + 5, f"diff upright {diff(ref, prox):.1f}, flipped {diff(ref, flipped):.1f}")
    pa = ffprobe(pdir / A("land1080-30")["proxyPath"])
    C.check("Proxy keeps its audio track", any(s["codec_type"] == "audio" for s in pa["streams"]))
    C.check("Silent source gives a video-only proxy", not any(s["codec_type"] == "audio" for s in ffprobe(pdir / A("silent")["proxyPath"])["streams"]))
    dur_gap = max(abs(float(ffprobe(pdir / A(k)["proxyPath"])["format"]["duration"]) - float(ffprobe(fx["clips"][k])["format"]["duration"])) for k in expect)
    C.check("Proxy duration matches source within 0.2s", dur_gap < 0.2, f"max gap {dur_gap:.2f}s")

    # ---- thumbnails, filmstrips, peaks
    cache = pdir / "cache"
    missing_files = [f"{k}:{kind}" for k in names for kind in ("thumb.jpg", "filmstrip.jpg") if not (cache / f"{A(k)['sha256']}.{kind}").exists()]
    C.check("Every video has a thumbnail and a filmstrip sprite", not missing_files, ", ".join(missing_files) or "10 x 2 files")
    fs = ffprobe(cache / f"{A('land1080-30')['sha256']}.filmstrip.jpg")["streams"][0]
    C.check("Filmstrip is 60 tiles of 160x90", (fs["width"], fs["height"]) == (9600, 90))
    th = ffprobe(cache / f"{A('portrait-rot')['sha256']}.thumb.jpg")["streams"][0]
    C.check("Portrait thumbnail is portrait (not cropped to 16:9)", th["height"] > th["width"], f"{th['width']}x{th['height']}")
    peaks = (cache / f"{A('land1080-30')['sha256']}.peaks").read_bytes()
    C.check("Peaks: one sample per 10ms with signal", abs(len(peaks) - (A('land1080-30')['durationUs'] / 1e4)) < 5 and max(peaks) > 20, f"{len(peaks)} samples, max {max(peaks)}")
    C.check("Silent clip records an empty peaks file (no repeat work)", (cache / f"{A('silent')['sha256']}.peaks").exists() and (cache / f"{A('silent')['sha256']}.peaks").stat().st_size == 0)
    C.check("Audio asset has peaks and image has a thumbnail", (cache / f"{aud['sha256']}.peaks").stat().st_size > 300 and (cache / f"{img['sha256']}.thumb.jpg").exists())
    C.check("Dashboard thumbnail is set automatically from the first imported clip", (pdir / "thumbnail.jpg").exists())
    C.check("No half-written files left behind", not list(pdir.rglob("*.part")) and not list(pdir.rglob("*.tmp")))
    tiles = page.locator("[data-testid=asset-tile]")
    C.check("Media panel shows 12 tiles with thumbnails loaded", tiles.count() == 12 and page.evaluate("() => [...document.querySelectorAll('[data-testid=asset-tile] img')].filter(i => i.naturalWidth > 0).length") >= 11,
            page.evaluate("() => [...document.querySelectorAll('[data-testid=asset-tile] img')].filter(i => i.naturalWidth > 0).length"))

    # ---- search and filter
    page.fill("input[placeholder=Search]", "portrait")
    C.check("Search narrows the grid by name", tiles.count() == 2, tiles.count())
    page.fill("input[placeholder=Search]", "")
    page.click("[data-testid=filter-audio]")
    C.check("Filter by type (audio)", tiles.count() == 1)
    page.click("[data-testid=filter-all]")

    # ---- preview of a proxy plays
    page.locator("[data-testid=asset-tile]", has_text="land720-24").get_by_label("Add to timeline").click(force=True)
    page.wait_for_selector("[data-testid=preview] canvas", timeout=15000)
    page.wait_for_timeout(2500)
    painted = page.evaluate("() => { const c = document.querySelector('[data-testid=preview] canvas'); const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data; if (!d) return -1; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] + d[i+1] + d[i+2] > 30) n++; return n; }")
    C.check("Adding a clip to the timeline shows it in the player (canvas painted, duration shown)", painted != 0 and f"00:{round(A('land720-24')['durationUs'] / 1e6):02d}:00" in page.locator("[data-testid=timecode]").inner_text(), f"painted samples {painted}")

    # ---- dedupe and bad input through the same import path
    app.pick([fx["dup"], fx["clips"]["land1080-30"], fx["txt"]])
    page.click("button:has-text('Import media')")
    wait_until(lambda: "already" in (page.locator("[data-testid=media-notice]").inner_text() if page.locator("[data-testid=media-notice]").count() else ""), 15)
    notice = wait_until(lambda: page.locator("[data-testid=media-notice]").inner_text() if page.locator("[data-testid=media-notice]").count() else None, 15)
    C.check("Duplicate content (same file, copy under another name) is not added again", len(proj()["assets"]) == 12 and "already in this project" in (notice or ""), notice)
    C.check("Unsupported file is rejected with a message", "notes.txt" in (notice or "") and "Unsupported" in (notice or ""), notice)
    C.check("assets/ holds one file per unique clip", len([f for f in (pdir / "assets").iterdir()]) == 12, len(list((pdir / "assets").iterdir())))

    # ---- security negatives
    def call(js):
        return page.evaluate("async (js) => { try { return {ok: await eval(js)}; } catch (e) { return {err: String(e)}; } }", js)
    r = call(f"window.studio.media.importPaths('not-a-uuid', ['{fx['clips']['silent']}'])")
    C.check("IPC rejects a non-UUID project id", "err" in r, r)
    r = call(f"window.studio.media.ensure('{pid}', [{{sha256: '../../etc/passwd', ext: 'mp4', type: 'video', metaMissing: false}}])")
    C.check("IPC rejects a path-like hash", "err" in r, r)
    r = call(f"window.studio.media.importPaths('{pid}', ['relative/clip.mp4'])")
    C.check("Relative path rejected", r.get("ok", {}).get("errors") and not r["ok"]["imported"], r)
    inside = next((pdir / "assets").iterdir())
    r = call(f"window.studio.media.importPaths('{pid}', ['{inside}'])")
    C.check("A file inside the app data folder cannot be imported", r.get("ok", {}).get("errors") and not r["ok"]["imported"], r)
    r = call(f"window.studio.media.importPaths('{pid}', ['/etc/hosts', '/etc/passwd'])")
    C.check("Non-media files outside the app are refused", r.get("ok", {}).get("errors") and not r["ok"]["imported"], r)
    r = call(f"fetch('media://local{pdir}/project.json').then(r => r.status)")
    C.check("media:// does not serve project.json", r.get("ok") == 403, r)
    r = call(f"fetch('media://local{cache}/{A('land1080-30')['sha256']}.peaks').then(r => r.status)")
    C.check("media:// does not serve non-media cache files", r.get("ok") == 403, r)
    r = call(f"fetch('media://local{pdir}/assets/../../index.json').then(r => r.status)")
    C.check("media:// refuses path traversal", r.get("ok") in (403, 404), r)

    # ---- persistence: reopen
    wait_until(lambda: json.loads((pdir / "project.json").read_text()) == proj(), 15)
    C.check("Manifest on disk matches the editor state (autosave)", json.loads((pdir / "project.json").read_text()) == proj())
    page.click("button:has-text('Projects')")
    page.click("[aria-label^='Open ']")
    page.wait_for_selector("[data-testid=media-panel]")
    page.wait_for_timeout(3000)
    sample_until(lambda: page.locator("[data-testid=asset-tile] img").count() >= 10, 15)
    C.check("Reopen: all 12 assets present, no work re-queued, thumbnails load",
            tiles.count() == 12 and page.get_by_text("Queued").count() == 0 and page.locator("[data-testid=asset-tile] img").count() >= 10,
            f"tiles={tiles.count()} queued={page.get_by_text('Queued').count()}")

    # ---- cancel, then resume
    long_clip = work / "fixtures" / "long.mp4"
    sh("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=500", "-t", "60", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", str(long_clip))
    app.pick([long_clip])
    page.click("button:has-text('Import media')")
    tile = page.locator("[data-testid=asset-tile]", has_text="long.mp4")
    started = wait_until(lambda: tile.count() and "Proxy" in tile.inner_text(), 60)
    C.check("Proxy progress is shown while encoding", bool(started), tile.inner_text().replace("\n", " | ") if tile.count() else "no tile")
    # An import that lands while a job is running must not be disturbed by the job's cleanup (review finding).
    extra = work / "fixtures" / "extra.mp4"
    sh("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2", "-t", "2", "-c:v", "libx264", str(extra))
    app.pick([extra])
    page.click("button:has-text('Import media')")
    ok_mid = wait_until(lambda: any(a["name"] == "extra.mp4" for a in proj()["assets"]), 20)
    C.check("An import during a running job is copied intact", bool(ok_mid) and "Could not copy" not in (page.locator("[data-testid=media-notice]").inner_text() if page.locator("[data-testid=media-notice]").count() else ""))
    if started:
        tile.get_by_text("Cancel").click()
    sha_long = next(a["sha256"] for a in proj()["assets"] if a["name"] == "long.mp4")
    gone = wait_until(lambda: tile.get_by_text("Cancel").count() == 0, 20)
    page.wait_for_timeout(1500)
    C.check("Cancel stops the proxy and leaves no partial file", bool(gone) and not (cache / f"{sha_long}.proxy.mp4").exists() and not list(cache.glob("*.part")), sorted(p.name for p in cache.glob(f"{sha_long}*")))
    tile.get_by_text("Make proxy").click()
    ok = wait_until(lambda: (cache / f"{sha_long}.proxy.mp4").exists() and any(a.get("proxyPath") and a["name"] == "long.mp4" for a in proj()["assets"]), 120)
    C.check("A cancelled proxy can be restarted and completes", bool(ok))

    # ---- missing media and relink
    victim = A("land720-24")
    page.click("button:has-text('Projects')")
    (pdir / "assets" / f"{victim['sha256']}.mp4").unlink()
    page.click("[aria-label^='Open ']")
    page.wait_for_selector("[data-testid=media-panel]")
    page.click("[data-testid=filter-missing]")
    shown = wait_until(lambda: tiles.count() == 1, 15)
    C.check("A deleted source file is flagged as missing after reopening", bool(shown) and "File missing" in tiles.first.inner_text(), tiles.count())
    app.pick([fx["clips"]["land720-24"]])
    tiles.first.get_by_text("Relink").click()
    relinked = wait_until(lambda: tiles.count() == 0 and (pdir / "assets" / f"{victim['sha256']}.mp4").exists(), 20)
    C.check("Relink restores the file and clears the missing flag", bool(relinked))
    page.click("[data-testid=filter-all]")

    # ---- memory (before cleanup): in-flight figures from the HUD
    s = mem.summary()
    C.metrics["memory"] = s
    C.check("Memory bar: total under 1.2GB during import (indicative on this machine)", s.get("peak_total_mb", 1e9) < 1200, s)
    C.check("Memory bar: no single renderer tab over 600MB", s.get("peak_single_tab_mb", 1e9) < 600, s.get("peak_single_tab_mb"))

    # ---- worker window closes when idle
    def worker_pages():  # live DevTools targets, not Playwright's cached page list
        import urllib.request
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
        return [t for t in targets if "worker=media" in t.get("url", "")]
    idle = wait_until(lambda: not worker_pages(), 60, 2)
    mem.sample(); page.wait_for_timeout(1500); mem.sample()
    C.check("Hidden worker window is closed after the queue is idle", bool(idle))

    # ---- unused cleanup
    C.check("An asset on the timeline is not offered for cleanup", f"Remove unused ({len(proj()['assets']) - 1})" in page.locator("[data-testid=media-panel]").inner_text())
    page.evaluate("() => window.__e2e.clearTimeline()")
    count = len(proj()["assets"])
    wait_until(lambda: settled(proj()), 60)
    page.click(f"button:has-text('Remove unused ({count})')")
    emptied = wait_until(lambda: len(proj()["assets"]) == 0, 20)
    page.wait_for_timeout(1000)
    C.check("Remove unused deletes manifest entries, copies and cache", bool(emptied) and not list((pdir / "assets").iterdir()) and not list(cache.iterdir()),
            f"assets={len(list((pdir / 'assets').iterdir()))} cache={len(list(cache.iterdir()))} dialogs={dialogs[-1:]}")
    C.check("Project is still saved and valid after cleanup", json.loads((pdir / "project.json").read_text())["assets"] == [])

    page.screenshot(path=str(work / "after.png"))
    log = (work / "app.log").read_text()
    # The security probes above deliberately trigger Zod rejections in these two handlers.
    expected = ("media:import-paths", "media:ensure")
    errs = [l for l in log.splitlines() if "Error" in l and "DevTools" not in l and "ExtensionLoadWarning" not in l and not any(e in l for e in expected)]
    C.check("No errors in the app log", not errs, errs[:3])
except Exception as exc:  # keep the report honest about a crash
    import traceback
    C.check("Run completed without crashing", False, traceback.format_exc()[-800:])
finally:
    for n in ("importing.png", "panel.png", "after.png"):
        if (work / n).exists():
            C.notes.append(str(work / n))
    C.notes.append(f"workdir {work}")
    try:
        app.stop()
    finally:
        C.save(out_json)
        sys.exit(0 if all(i["ok"] for i in C.items) else 1)
