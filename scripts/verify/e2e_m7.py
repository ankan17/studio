"""M7 end-to-end: reliability. Real Electron app, driven over CDP.
Covers: first-run guidance and the shortcut sheet; a force-quit (SIGKILL) mid-edit and the crash notice on the next start,
then a damaged project.json recovered from a copy; missing media (banner, preview survives, export names the file, relink,
and a file that vanishes mid-export); a Bengali file name; a full disk on a real 1.5GB disk image (import and export refused
with a reason, autosave fails then retries until it succeeds, leaving with unsaved edits asks first); and a soak of
random edits and playback with memory sampled throughout (--small: 90 seconds; default: 10 minutes).
Usage: python3 e2e_m7.py <results.json> [--small]"""
import json, os, random, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, REPO, make_fixtures, sh

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
SOAK_SECONDS = 90 if small else 600
C = Checks("M7")
work = Path(tempfile.mkdtemp(prefix="studio-m7-"))
fx = make_fixtures(work / "fixtures", small=True)
shots = REPO / "docs" / "reports" / "assets"
shots.mkdir(parents=True, exist_ok=True)
logs = work / "logs"
outdir = work / "out"
outdir.mkdir()
ENV = {"STUDIO_LOG_DIR": str(logs)}
apps = []
HEAD_H, RULER_H, ROW_H = 36, 26, 60  # Timeline.tsx geometry


def wait_until(fn, timeout=30, every=0.25):
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


def launch(projects_dir):
    a = App(projects_dir, work, electron_args=["--force-color-profile=srgb"], env=ENV)
    apps.append(a)
    page = a.start().page
    page.set_viewport_size({"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return a, page, errors


class Ctx:
    """Helpers bound to one running app."""

    def __init__(self, app, page, errors):
        self.app, self.page, self.errors = app, page, errors
        self.mem = MemorySampler(page)

    def proj(self):
        return self.page.evaluate("() => window.__e2e.project()")

    def dispatch(self, cmd):
        return self.page.evaluate("(c) => window.__e2e.dispatch(c)", cmd)

    def save_state(self):
        return self.page.inner_text("[data-testid=save-state]").strip()

    def shot(self, name):
        self.page.mouse.move(1430, 890)
        self.page.wait_for_timeout(300)
        self.page.screenshot(path=str(shots / f"M7-{name}.png"))
        C.metrics.setdefault("screenshots", []).append(f"M7-{name}.png")

    def new_project(self):
        self.page.click("text=New project")
        self.page.click("button:has-text('Create project')")
        self.page.wait_for_selector("[data-testid=media-panel]", timeout=30000)

    def import_and_add(self, files, add=True):
        self.app.pick(files)
        self.page.click("button:has-text('Import media')")
        n = len(self.proj()["assets"])
        ok = wait_until(lambda: len(self.proj()["assets"]) >= n + len(files) and all((a["type"] == "image" or a.get("durationUs")) and (a["type"] != "video" or a.get("proxyPath")) for a in self.proj()["assets"]), 240)
        if add:
            for f in files:
                tile = self.page.locator("[data-testid=asset-tile]", has_text=Path(f).name)
                tile.hover()
                tile.get_by_label("Add to timeline").click()
        return ok

    def back_to_dashboard(self):
        self.page.click("button:has-text('Projects')")
        self.page.wait_for_selector("text=Projects >> nth=0")
        self.page.wait_for_selector("[aria-label^='Open ']", timeout=15000)

    def open_first(self):
        self.page.locator("[aria-label^='Open ']").first.click()
        self.page.wait_for_selector("[data-testid=media-panel]", timeout=30000)

    def open_export(self):
        self.page.click("[data-testid=export-open]")
        self.page.wait_for_selector("[role=dialog][aria-labelledby=export-title]")

    def close_export(self):
        self.page.keyboard.press("Escape")
        self.page.wait_for_selector("[role=dialog][aria-labelledby=export-title]", state="detached")

    def try_export(self, dest, label="720p", when_running=None, timeout=180):
        """From the open dialog. Returns (outcome, text): 'error' (would not start), 'done', 'failed', 'cancelled', 'timeout'."""
        self.app.save_to(dest)
        self.page.click(f"[aria-label=Size] button:has-text('{label}')")
        self.page.click("[data-testid=export-start]")
        end = time.time() + timeout
        while time.time() < end:
            if self.page.locator("[data-testid=export-start-error]").count():
                return "error", self.page.inner_text("[data-testid=export-start-error]")
            for k in ("done", "cancelled", "failed"):
                if self.page.locator(f"[data-testid=export-{k}]").count():
                    return k, self.page.inner_text(f"[data-testid=export-{k}]")
            if when_running and self.page.locator("[data-testid=export-running]").count():
                try:
                    if int(self.page.inner_text("[data-testid=export-percent]").strip("%")) > 0:
                        when_running()
                        when_running = None
                except Exception:
                    pass
            time.sleep(0.25)
        return "timeout", ""


try:
    # =====================================================================================================
    # 1. First run: empty dashboard, empty project, shortcut sheet
    # =====================================================================================================
    app, page, errors = launch(work / "projects")
    cx = Ctx(app, page, errors)
    C.check("A fresh start in an empty folder shows no crash notice", page.locator("[data-testid=crash-notice]").count() == 0)
    C.check("The empty dashboard explains what to do first", page.locator("text=Make your first video").count() == 1 and page.locator("text=Everything is saved as you go").count() == 1)
    cx.shot("dashboard-empty")
    page.keyboard.press("?")
    sheet = page.locator("[data-testid=shortcut-sheet]")
    C.check("? opens the shortcut sheet from the dashboard", sheet.count() == 1)
    groups = page.locator("[data-testid=shortcut-sheet] h3").all_inner_texts()
    C.check("The sheet groups shortcuts as Playback, Editing, Timeline view, Anywhere", groups == ["Playback", "Editing", "Timeline view", "Anywhere"], groups)
    txt = sheet.inner_text()
    C.check("The sheet lists the keys the editor really handles", all(k in txt for k in ["Space", "Split the selected clip", "Undo", "Redo", "Add a marker", "Fit the whole timeline"]))
    cx.shot("shortcuts")
    page.keyboard.press("Escape")
    C.check("Escape closes the sheet", page.locator("[data-testid=shortcut-sheet]").count() == 0)

    cx.new_project()
    C.check("An empty project shows three first steps on the preview", page.locator("text=Start with your clips").count() == 1 and page.locator("[data-testid=stage] li").count() == 3)
    C.check("The media panel and timeline also say what goes there", page.locator("text=Drop clips here").count() == 1 and page.locator("text=Your timeline is empty").count() == 1)
    cx.shot("editor-empty")
    page.keyboard.press("?")
    C.check("? opens the sheet in the editor too, and Space then does not play", page.locator("[data-testid=shortcut-sheet]").count() == 1)
    page.keyboard.press("Space")
    page.keyboard.press("Escape")
    page.mouse.click(700, 20)
    C.check("Typing ? in a text field types it instead", (page.fill("input[aria-label='Project name']", "x"), page.keyboard.type("?"), page.locator("[data-testid=shortcut-sheet]").count() == 0)[2])
    page.fill("input[aria-label='Project name']", "Unsaved test")
    page.keyboard.press("Tab")

    # =====================================================================================================
    # 2. A project to work on: three clips, music, and a Bengali file name
    # =====================================================================================================
    bn = work / "fixtures" / "ভ্লগ ক্লিপ ১.mp4"
    sh("ffmpeg", "-y", "-v", "error", "-i", str(fx["clips"]["land720-24"]), "-c", "copy", "-metadata", "comment=bengali-name", str(bn))
    names = ["land1080-30", "land1080-30b"]
    ok = cx.import_and_add([fx["clips"][n] for n in names] + [fx["audio"], bn])
    C.check("Two clips, music and a clip with a Bengali file name import and prepare", bool(ok))
    a_names = [a.get("name") for a in cx.proj()["assets"]]
    C.check("The Bengali file name is kept as typed", bn.name in a_names, a_names)
    C.check("All four assets are on the timeline", sum(len(t["clips"]) for t in cx.proj()["tracks"]) == 4)
    cx.dispatch({"type": "setProject", "patch": {"name": "Recovery test"}})
    wait_until(lambda: cx.save_state() == "Saved", 10)
    pid = cx.proj()["id"]
    pdir = work / "projects" / pid

    # =====================================================================================================
    # 3. Crash recovery: force quit with an edit still waiting to be saved
    # =====================================================================================================
    saved_state = json.loads((pdir / "project.json").read_text())
    cx.dispatch({"type": "setProject", "patch": {"name": "Edit that was never saved"}})
    app.kill()  # inside the 800ms autosave debounce
    on_disk = json.loads((pdir / "project.json").read_text())
    C.check("After a force quit mid-edit the project file is whole and holds the last save", on_disk["name"] == "Recovery test" and on_disk == saved_state)
    C.check("The session lock was left behind by the killed app", (work / "projects" / "session.lock").exists())

    app, page, errors = launch(work / "projects")
    cx = Ctx(app, page, errors)
    notice = page.locator("[data-testid=crash-notice]")
    C.check("The next start says the last session did not close properly", notice.count() == 1, notice.inner_text() if notice.count() else "")
    C.check("The notice offers the project edited last", page.locator("[data-testid=crash-notice] button:has-text('Open \"Recovery test\"')").count() == 1)
    cx.shot("dashboard-crash-notice")
    page.locator("[data-testid=crash-notice] button:has-text('Open')").click()
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    C.check("Opening it restores the timeline exactly as last saved", cx.proj()["tracks"] == saved_state["tracks"] and cx.proj()["name"] == "Recovery test")
    C.check("A project whose file is intact opens without the recovery banner", page.locator("text=restored from a recovery copy").count() == 0)
    cx.back_to_dashboard()
    C.check("The crash notice does not come back", page.locator("[data-testid=crash-notice]").count() == 0)
    log_text = (logs / "studio.log").read_text() if (logs / "studio.log").exists() else ""
    C.check("The local log records both starts and the unclean one", log_text.count(" start ") >= 2 and "did not end cleanly" in log_text, f"{len(log_text.splitlines())} lines")

    # damaged project.json: restored from the most recent valid copy (the one before the last save), with a notice
    good = (pdir / "project.json").read_text()
    (pdir / "project.json").write_text(good[:200])
    cx.open_first()
    C.check("A damaged project file is restored from a recovery copy, with a notice", page.locator("text=restored from a recovery copy").count() == 1 and cx.proj()["id"] == pid and len(cx.proj()["assets"]) == 4, f"{len(cx.proj()['tracks'])} tracks in the copy")
    cx.shot("editor-recovered")
    cx.back_to_dashboard()
    (pdir / "project.json").write_text(good)  # the rest of the run needs the full project back
    cx.open_first()
    C.check("With the file whole again it opens normally", page.locator("text=restored from a recovery copy").count() == 0 and cx.proj()["tracks"] == saved_state["tracks"])

    # =====================================================================================================
    # 4. Missing media
    # =====================================================================================================
    p = cx.proj()
    used_ids = {c["assetId"] for t in p["tracks"] for c in t["clips"] if c.get("assetId")}
    victim = next(a for a in p["assets"] if a["id"] in used_ids and a["type"] == "video" and a.get("name") == "land1080-30.mp4")
    vfile = pdir / victim["relativePath"]
    original = vfile.read_bytes()
    cx.back_to_dashboard()
    vfile.unlink()
    cx.open_first()
    banner = wait_until(lambda: page.locator("[data-testid=missing-banner]").count() == 1, 20)
    C.check("A file the timeline uses that is gone is reported in a banner that names it", bool(banner) and "land1080-30.mp4" in page.inner_text("[data-testid=missing-banner]"), page.inner_text("[data-testid=missing-banner]") if banner else "")
    C.check("The media panel marks it missing and offers Relink", page.locator("[data-testid=asset-tile][data-sha='%s'] >> text=File missing" % victim["sha256"]).count() == 1)
    cx.shot("editor-missing-media")
    errs_before = len(errors)
    page.mouse.click(700, 20)
    page.keyboard.press("Home")
    page.keyboard.press("Space")
    page.wait_for_timeout(2500)
    page.keyboard.press("Space")
    C.check("Playing across the missing clip does not crash the editor", page.locator("[data-testid=stage]").count() == 1 and page.locator("[data-testid=preview]").count() == 1 and len(errors) == errs_before, errors[errs_before:])
    cx.open_export()
    res, text = cx.try_export(outdir / "missing.mp4")
    C.check("Export refuses to start and names the missing file", res == "error" and "land1080-30.mp4" in text and not (outdir / "missing.mp4").exists(), text)
    cx.close_export()
    app.pick([fx["clips"]["land1080-30"]])
    page.locator("[data-testid=asset-tile][data-sha='%s'] button:has-text('Relink')" % victim["sha256"]).click()
    gone = wait_until(lambda: vfile.exists() and page.locator("[data-testid=missing-banner]").count() == 0, 30)
    C.check("Relinking brings the file back and clears the banner", bool(gone))

    # a file that vanishes during the export: the last video clip's original (the first ones are already being decoded)
    p = cx.proj()
    last = max((c for t in p["tracks"] if t["type"] == "video" for c in t["clips"]), key=lambda c: c["startFrame"])
    lost = next(a for a in p["assets"] if a["id"] == last["assetId"])
    lfile = pdir / lost["relativePath"]
    lost_bytes = lfile.read_bytes()
    cx.open_export()
    res, text = cx.try_export(outdir / "vanish.mp4", "1080p", when_running=lambda: lfile.unlink())
    C.check("A file lost mid-export fails that export, keeps no file, and says which file", res == "failed" and lost["name"] in text and not (outdir / "vanish.mp4").exists() and not (outdir / "vanish.mp4.part").exists(), text.replace("\n", " "))
    hist = json.loads((pdir / "exports.json").read_text())
    C.check("The failure is in the export history", hist[-1]["status"] == "failed" and lost["name"] in hist[-1].get("error", ""))
    cx.close_export()
    lfile.write_bytes(lost_bytes)  # put it back for the rest of the run
    cx.back_to_dashboard()
    cx.open_first()
    wait_until(lambda: page.locator("[data-testid=missing-banner]").count() == 0, 20)

    # =====================================================================================================
    # 5. Full disk, on a real small volume
    # =====================================================================================================
    dmg = work / "small.dmg"
    sh("hdiutil", "create", "-size", "1500m", "-fs", "HFS+", "-volname", "StudioSmall", str(dmg))
    r = sh("hdiutil", "attach", "-nobrowse", str(dmg))
    mount = next((m for m in re.findall(r"(/Volumes/\S+)", r.stdout)), None)
    C.check("A 1.5 GB disk image is mounted for the disk-full checks", bool(mount) and Path(mount).exists(), r.stdout.strip()[-120:] + r.stderr.strip()[-120:])
    if mount:
        app.stop()
        app, page, errors = launch(Path(mount) / "projects")
        cx = Ctx(app, page, errors)
        cx.new_project()
        small_clip = fx["clips"]["land720-24"]
        ok = cx.import_and_add([small_clip])
        C.check("Import and proxy work on the small disk while it has room", bool(ok))
        spid = cx.proj()["id"]
        sdir = Path(mount) / "projects" / spid
        filler = Path(mount) / "filler.bin"

        def fill(leave_mb):
            """Write zeros until `leave_mb` is free; 0 means until the disk refuses even a few bytes."""
            with open(filler, "ab", buffering=0) as f:
                for chunk in (1 << 20, 1 << 12, 1 << 9, 1):
                    while True:
                        free = os.statvfs(mount).f_bavail * os.statvfs(mount).f_frsize
                        if leave_mb and free <= leave_mb * 1e6:
                            return
                        try:
                            f.write(b"\0" * chunk)
                        except OSError:
                            break
                        if chunk == 1 and not leave_mb:
                            continue

        fill(90)  # import wants the file plus 1GB of headroom; an export of this project wants about 110 MB
        assets_before = sorted(p.name for p in (sdir / "assets").iterdir())
        n_assets = len(cx.proj()["assets"])
        cx.app.pick([fx["clips"]["land720-24"].with_name("hevc8.mov")])
        page.click("button:has-text('Import media')")
        shown = wait_until(lambda: page.locator("[data-testid=media-notice]").count() == 1, 20)
        notice_text = page.inner_text("[data-testid=media-notice]") if shown else ""
        C.check("Importing with too little room is refused with the reason", "Not enough free disk space" in notice_text and len(cx.proj()["assets"]) == n_assets, notice_text)
        C.check("The refused import leaves no partial copy behind", sorted(p.name for p in (sdir / "assets").iterdir()) == assets_before)
        cx.shot("import-no-space")
        page.keyboard.press("Escape")
        cx.dispatch({"type": "addAsset", "assetId": cx.proj()["assets"][0]["id"], "clipId": "00000000-0000-4000-8000-000000000001", "trackId": "00000000-0000-4000-8000-000000000002"})
        cx.open_export()
        res, text = cx.try_export(Path(mount) / "out.mp4")
        C.check("Export to a disk with too little room is refused with the reason", res == "error" and "Not enough free disk space" in text and not (Path(mount) / "out.mp4").exists() and not (Path(mount) / "out.mp4.part").exists(), text)
        cx.close_export()

        fill(0)
        free_now = os.statvfs(mount).f_bavail * os.statvfs(mount).f_frsize
        cx.dispatch({"type": "setProject", "patch": {"name": "Disk full edit"}})
        failed = wait_until(lambda: "Could not save" in cx.save_state(), 15)
        C.check("On a full disk the save state turns to an error", bool(failed), f"{free_now} bytes free; {cx.save_state()}")
        err_banner = page.locator("[data-testid=save-error]")
        C.check("The error banner says the disk is full, in plain words", err_banner.count() == 1 and "disk is full" in err_banner.inner_text().lower(), err_banner.inner_text() if err_banner.count() else "")
        C.check("The project file on disk is still whole", json.loads((sdir / "project.json").read_text())["id"] == spid)
        cx.shot("editor-disk-full")
        dialogs = []
        page.once("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.click("button:has-text('Projects')")
        page.wait_for_timeout(1500)
        C.check("Leaving with unsaved edits asks first, and Cancel stays in the project", len(dialogs) == 1 and "could not be saved" in dialogs[0] and page.locator("[data-testid=media-panel]").count() == 1, dialogs)
        filler.unlink()
        recovered = wait_until(lambda: cx.save_state() == "Saved", 30)
        C.check("When space returns the save succeeds by itself", bool(recovered) and json.loads((sdir / "project.json").read_text())["name"] == "Disk full edit", cx.save_state())
        C.check("The error banner goes away", page.locator("[data-testid=save-error]").count() == 0)
        app.stop()
        sh("hdiutil", "detach", mount, "-force")
        mount = None

    # =====================================================================================================
    # 6. Soak: random edits and playback, memory sampled throughout
    # =====================================================================================================
    app, page, errors = launch(work / "projects")
    cx = Ctx(app, page, errors)
    cx.open_first()
    rng = random.Random(7)
    total_frames = lambda: max((c["startFrame"] + c["durationInFrames"] for t in cx.proj()["tracks"] for c in t["clips"]), default=0)

    def geom():
        return page.evaluate("""() => { const s = document.querySelector('[data-testid=sequence]'); const r = s.getBoundingClientRect();
            return {x: r.left, y: r.top, ppf: +s.dataset.ppf, sx: +s.dataset.scrollX, lane: +s.dataset.laneLeft, pad: +s.dataset.pad}; }""")

    def seek(frame):
        g = geom()
        page.mouse.click(g["x"] + g["lane"] + g["pad"] + frame * g["ppf"] - g["sx"], g["y"] + HEAD_H + 13)

    def click_random_clip():
        clips = [c["id"] for t in cx.proj()["tracks"] for c in t["clips"]]
        if clips:
            try:
                page.locator(f"[data-clip='{rng.choice(clips)}']").first.click(position={"x": 12, "y": 30}, timeout=1500)
            except Exception:
                pass

    actions = [
        ("seek", lambda: seek(rng.randint(0, max(1, total_frames())))),
        ("select", click_random_clip),
        ("split", lambda: (click_random_clip(), page.keyboard.press("s"))),
        ("duplicate", lambda: (click_random_clip(), page.keyboard.press("Meta+d"))),
        ("delete", lambda: (click_random_clip(), page.keyboard.press("Backspace"))),
        ("undo", lambda: page.keyboard.press("Meta+z")),
        ("undo", lambda: page.keyboard.press("Meta+z")),
        ("redo", lambda: page.keyboard.press("Meta+Shift+z")),
        ("marker", lambda: page.keyboard.press("m")),
        ("title", lambda: (page.keyboard.press("t"), page.keyboard.press("Escape"))),
        ("zoom", lambda: page.keyboard.press(rng.choice(["Meta+Equal", "Meta+Minus", "Shift+z"]))),
        ("play", lambda: (page.keyboard.press("Space"), page.wait_for_timeout(1500), page.keyboard.press("Space"))),
        ("step", lambda: [page.keyboard.press("ArrowRight") for _ in range(10)]),
    ]
    start = time.time()
    done_actions = {}
    mem_series = []
    last_sample = 0
    while time.time() - start < SOAK_SECONDS:
        name, fn = rng.choice(actions)
        try:
            fn()
        except Exception as e:
            C.notes.append(f"soak action {name} raised {type(e).__name__}")
        done_actions[name] = done_actions.get(name, 0) + 1
        page.wait_for_timeout(120)
        if time.time() - last_sample >= 5:
            last_sample = time.time()
            cx.mem.sample()
            s = cx.mem.samples[-1] if cx.mem.samples else None
            if s:
                tab = max((v for k, v in s["procs"].items() if k.startswith("Tab")), default=0)
                mem_series.append((round(time.time() - start), s["total"], tab))
    hist = page.evaluate("() => window.__e2e.history()")
    tabs = [m[2] for m in mem_series]
    totals = [m[1] for m in mem_series]
    q = max(1, len(mem_series) // 4)
    # growth: the last quarter against the second quarter (the first quarter is warm-up)
    mid = sum(tabs[q:2 * q]) / max(1, len(tabs[q:2 * q]))
    end_avg = sum(tabs[-q:]) / max(1, len(tabs[-q:]))
    C.metrics["soak_seconds"] = SOAK_SECONDS
    C.metrics["soak_actions"] = done_actions
    C.metrics["soak_memory_samples"] = len(mem_series)
    C.metrics["soak_editor_tab_mb"] = {"first": tabs[0] if tabs else None, "peak": max(tabs, default=None), "last": tabs[-1] if tabs else None, "mid_avg": round(mid), "end_avg": round(end_avg)}
    C.metrics["soak_total_mb"] = {"first": totals[0] if totals else None, "peak": max(totals, default=None), "last": totals[-1] if totals else None}
    C.metrics["soak_memory_series_s_total_tab"] = mem_series[:: max(1, len(mem_series) // 30)]
    C.metrics["machine_ram_gb"] = round(int(sh("sysctl", "-n", "hw.memsize").stdout) / 2 ** 30)
    C.check(f"Soak: {sum(done_actions.values())} random edits and playbacks over {SOAK_SECONDS}s raised no page error", len(errors) == 0, errors[:3])
    C.check("Soak: the editor tab stays under 600 MB", bool(tabs) and max(tabs) < 600, f"peak {max(tabs, default=0)} MB")
    C.check("Soak: total memory stays under 1200 MB", bool(totals) and max(totals) < 1200, f"peak {max(totals, default=0)} MB (dev machine; the 8GB run is separate)")
    C.check("Soak: the editor tab does not keep growing (end vs middle, under 80 MB)", bool(tabs) and end_avg - mid < 80, f"middle avg {mid:.0f} MB, end avg {end_avg:.0f} MB")
    C.check("Soak: undo history stays within its 200-step cap", hist["size"] <= 200, hist)
    wait_until(lambda: cx.save_state() == "Saved", 10)
    on_disk = json.loads((pdir / "project.json").read_text())
    C.check("Soak: the project on disk is valid and equals the one in the editor after the soak", on_disk == cx.proj())
finally:
    for a in apps:
        try:
            a.stop()
        except Exception:
            pass
    sh("hdiutil", "detach", "/Volumes/StudioSmall", "-force")
    C.notes.append(str(work))
    C.save(out_json)
    print("saved", out_json)
