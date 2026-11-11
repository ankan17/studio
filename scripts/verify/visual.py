#!/usr/bin/env python3
"""Visual regression tests: drive the real app through its UI states, screenshot each one and compare it with a baseline.

    python3 scripts/verify/visual.py            # compare against scripts/verify/visual-baselines/
    python3 scripts/verify/visual.py --update   # accept the current screenshots as the new baselines
    python3 scripts/verify/visual.py --only editor-timeline-start,dashboard-cards

Results go to docs/reports/visual/ (gitignored): index.html shows baseline, actual and diff side by side for every shot,
results.json has the numbers. A shot with no baseline yet is saved as its baseline and reported as "new".

Screenshots are taken at CSS pixel scale (1440x900 window) with animations and the caret off; the memory HUD and the
"edited <date>" lines are masked. Each shot is retaken until two consecutive captures are identical, so a
half-loaded thumbnail or a decoder still settling cannot slip through. Baselines are machine-specific (fonts, GPU,
ffmpeg build): regenerate them with --update on a new machine and review the result before committing.
"""
import base64, html, json, shutil, sys, tempfile, time, traceback
from pathlib import Path
from lib import App, REPO, make_fixtures

BASE = Path(__file__).resolve().parent / "visual-baselines"
OUT = REPO / "docs" / "reports" / "visual"
UPDATE = "--update" in sys.argv
ONLY = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")), None)
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1].split(",")
CHANNEL_TOL = 8         # a pixel counts as changed when any channel moves by more than this (0-255)
MAX_CHANGED = 0.001     # a shot fails when more than 0.1% of its pixels changed
W, H = 1440, 900

# Runs inside the app page: decode two PNGs, count changed pixels, paint a diff (dimmed actual, changes in red).
DIFF_JS = """async ([a64, b64, tol]) => {
  const load = async (s) => createImageBitmap(new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], {type: 'image/png'}));
  const [a, b] = await Promise.all([load(a64), load(b64)]);
  if (a.width !== b.width || a.height !== b.height) return {sizeMismatch: true, a: [a.width, a.height], b: [b.width, b.height]};
  const px = (bmp) => { const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height); };
  const da = px(a).data, db = px(b);
  const out = new ImageData(a.width, a.height); const o = out.data, d = db.data;
  let changed = 0, maxDelta = 0;
  for (let i = 0; i < da.length; i += 4) {
    const delta = Math.max(Math.abs(da[i] - d[i]), Math.abs(da[i+1] - d[i+1]), Math.abs(da[i+2] - d[i+2]));
    if (delta > maxDelta) maxDelta = delta;
    if (delta > tol) { changed++; o[i] = 255; o[i+1] = 40; o[i+2] = 60; o[i+3] = 255; }
    else { const g = (d[i] + d[i+1] + d[i+2]) / 3 * 0.35; o[i] = o[i+1] = o[i+2] = g; o[i+3] = 255; }
  }
  const c = new OffscreenCanvas(a.width, a.height); c.getContext('2d').putImageData(out, 0, 0);
  const blob = await c.convertToBlob({type: 'image/png'});
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return {changed, total: da.length / 4, maxDelta, diff: btoa(s)};
}"""


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


class Shots:
    def __init__(self, page):
        self.page, self.results = page, []
        self.extra_masks = []  # footage that is not stable between runs (see the duplicate import below)

    def settle(self):
        p = self.page
        p.mouse.move(W - 2, H - 2)  # park the pointer where it hovers nothing
        p.evaluate("""async () => { await document.fonts.ready;
            await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); }""")
        if p.locator("[data-testid=save-state]").count():
            wait_until(lambda: "Saved" in p.inner_text("[data-testid=save-state]"), 10)

    def capture(self, target):
        # the whole status bar (the HUD's width follows its text) and the "edited <date>" lines on project cards
        mask = [self.page.locator("footer"), self.page.get_by_text("edited ", exact=False), *self.extra_masks]
        kw = dict(type="png", scale="css", animations="disabled", caret="hide", mask=mask, mask_color="#ff00ff")
        return target.screenshot(**kw)

    def shot(self, name, desc, element=None, hover=None):
        if ONLY and name not in ONLY:
            return
        self.settle()
        target = self.page.locator(element) if element else self.page
        forced = self.force_hover(hover) if hover else None
        try:
            png, stable = self.stable_capture(target)
        finally:
            if forced:
                self.cdp.send("CSS.forcePseudoState", {"nodeId": forced, "forcedPseudoClasses": []})
        self.record(name, desc, png, stable)

    def force_hover(self, selector):
        """Force :hover on the element through DevTools. A real mouse hover is unreliable in an unfocused window."""
        if not hasattr(self, "cdp"):
            self.cdp = self.page.context.new_cdp_session(self.page)
            self.cdp.send("DOM.enable"); self.cdp.send("CSS.enable")
        root = self.cdp.send("DOM.getDocument", {"depth": 0})["root"]["nodeId"]
        node = self.cdp.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
        if not node:
            raise RuntimeError(f"hover target not found: {selector}")
        self.cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": ["hover"]})
        self.page.wait_for_timeout(300)
        return node

    def stable_capture(self, target):
        # retake until two consecutive captures match: nothing is still loading or decoding
        prev, png, stable = None, None, False
        for _ in range(12):
            png = self.capture(target)
            if png == prev:
                stable = True
                break
            prev = png
            self.page.wait_for_timeout(300)
        return png, stable

    def record(self, name, desc, png, stable):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"{name}.actual.png").write_bytes(png)
        base = BASE / f"{name}.png"
        r = {"name": name, "desc": desc, "stable": stable}
        if UPDATE or not base.exists():
            BASE.mkdir(parents=True, exist_ok=True)
            base.write_bytes(png)
            r.update(status="updated" if UPDATE else "new", ok=True)
        else:
            d = self.page.evaluate(DIFF_JS, [base64.b64encode(base.read_bytes()).decode(), base64.b64encode(png).decode(), CHANNEL_TOL])
            if d.get("sizeMismatch"):
                r.update(status="size changed", ok=False, detail=f"baseline {d['a']} vs now {d['b']}")
            else:
                (OUT / f"{name}.diff.png").write_bytes(base64.b64decode(d["diff"]))
                ratio = d["changed"] / d["total"]
                ok = ratio <= MAX_CHANGED
                r.update(status="match" if d["changed"] == 0 else ("within tolerance" if ok else "CHANGED"), ok=ok,
                         changed=d["changed"], ratio=ratio, max_delta=d["maxDelta"])
        shutil.copyfile(base, OUT / f"{name}.baseline.png")
        if not stable:
            r["detail"] = (r.get("detail", "") + " never stabilised (two captures in a row always differed)").strip()
        self.results.append(r)
        extra = f"{r.get('changed', 0)} px ({r.get('ratio', 0) * 100:.3f}%)" if "ratio" in r else r.get("detail", "")
        print(f"[{'PASS' if r['ok'] else 'FAIL'}] {name}: {r['status']} {extra}", flush=True)


def write_report(results, error, workdir):
    (OUT / "results.json").write_text(json.dumps({"results": results, "error": error}, indent=2))
    rows = []
    for r in results:
        n = r["name"]
        badge = "ok" if r["ok"] else "bad"
        stats = f"{r.get('changed', 0):,} px changed ({r.get('ratio', 0) * 100:.3f}%), max channel delta {r.get('max_delta', 0)}" if "ratio" in r else html.escape(r.get("detail", ""))
        diff = f'<figure><img src="{n}.diff.png" loading="lazy"><figcaption>Diff</figcaption></figure>' if (OUT / f"{n}.diff.png").exists() and "ratio" in r else ""
        rows.append(f"""<section class="{badge}" id="{n}"><header><h2>{n}</h2><span class="badge">{html.escape(r['status'])}</span></header>
<p>{html.escape(r['desc'])}<br><small>{stats}</small></p>
<div class="imgs"><figure><img src="{n}.baseline.png" loading="lazy"><figcaption>Baseline</figcaption></figure>
<figure><img src="{n}.actual.png" loading="lazy"><figcaption>Actual</figcaption></figure>{diff}</div></section>""")
    failed = [r for r in results if not r["ok"]]
    summary = f"{len(results) - len(failed)}/{len(results)} shots pass" + (f" · run error: {html.escape(error)}" if error else "")
    (OUT / "index.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Studio visual tests</title>
<style>:root{{color-scheme:dark;--bg:#0e0f11;--panel:#17181c;--line:#2a2c33;--ink:#ecedf0;--dim:#9a9ca5;--ok:#2dbf9a;--bad:#ff4d5e}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,system-ui,sans-serif;padding:24px}}
h1{{font-size:20px;margin:0 0 4px}} .sum{{color:var(--dim);margin-bottom:20px}} pre{{white-space:pre-wrap;color:var(--bad)}}
section{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}}
section.bad{{border-color:var(--bad)}} header{{display:flex;gap:10px;align-items:center}} h2{{font-size:14px;margin:0;font-family:ui-monospace,monospace}}
.badge{{font-size:11px;padding:1px 8px;border-radius:99px;background:color-mix(in srgb,var(--ok) 20%,transparent);color:var(--ok)}}
.bad .badge{{background:color-mix(in srgb,var(--bad) 20%,transparent);color:var(--bad)}} p{{color:var(--dim);margin:6px 0 10px}}
.imgs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}} figure{{margin:0}}
img{{width:100%;border:1px solid var(--line);border-radius:6px;display:block;cursor:zoom-in}} figcaption{{font-size:11px;color:var(--dim);margin-top:4px}}
</style><h1>Studio visual tests</h1><div class="sum">{summary} · generated {time.strftime('%Y-%m-%d %H:%M')} · workdir {html.escape(str(workdir))}</div>
{f'<pre>{html.escape(error)}</pre>' if error else ''}{''.join(sorted(rows, key=lambda s: 'class="ok"' in s))}
<script>document.querySelectorAll('img').forEach(i=>i.onclick=()=>open(i.src))</script>""")


def main():
    work = Path(tempfile.mkdtemp(prefix="studio-visual-"))
    fx = make_fixtures(work / "fixtures", small=True)  # always the short clips, so durations in the UI stay fixed
    app = App(work / "projects", work)
    error, s = None, None
    try:
        page = app.start().page
        page.set_viewport_size({"width": W, "height": H})
        s = Shots(page)
        proj = lambda: page.evaluate("() => window.__e2e.project()")
        current = lambda: page.inner_text("[data-testid=timecode]").split("/")[0].strip()
        painted = lambda: page.evaluate("""() => { const c = document.querySelector('[data-testid=preview] canvas'); if (!c) return false;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0, n = 0;
            for (let i = 0; i < d.length; i += 64) { n++; if (d[i] + d[i+1] + d[i+2] < 30) dark++; } return dark / n < 0.95; }""")

        def media_idle(n):
            p = proj()
            done = len(p["assets"]) == n and all(a.get("durationUs") or a["type"] == "image" for a in p["assets"]) and all(a.get("proxyPath") for a in p["assets"] if a["type"] == "video")
            # the UI is idle when no tile has a job: no Cancel/Retry button and no stage text (Waiting, Reading, Preview 40%...)
            busy = page.evaluate("() => [...document.querySelectorAll('[data-testid=asset-tile]')].some(t => /Cancel|Retry|Waiting|Reading|\\d+%/.test(t.innerText))")
            return done and not busy

        def new_project(name, fmt=None):
            page.click("button:has-text('New project')")
            page.fill("input[autofocus], form input", name)
            if fmt:
                page.click(f"button:has-text('{fmt}')")
            page.click("button:has-text('Create project')")
            page.wait_for_selector("[data-testid=media-panel]", timeout=30000)

        def focus_body():
            page.mouse.click(W - 300, 20)  # header gap, focuses no input

        # ---- dashboard and new project dialog
        page.wait_for_selector("text=Make your first video")
        s.shot("dashboard-empty", "Dashboard with no projects: empty state and New project button.")
        page.click("button:has-text('New project') >> nth=0")
        page.wait_for_selector("text=Pick the shape")
        s.shot("dialog-new-project", "New project dialog with defaults (Landscape, 30 fps).")
        page.click("button:has-text('Vertical')")
        page.click("button:has-text('60 fps')") if page.locator("button:has-text('60 fps')").count() else None
        s.shot("dialog-new-project-vertical", "New project dialog with Vertical and a different frame rate selected.")
        page.keyboard.press("Escape")

        # ---- empty editor, import
        new_project("Visual test")
        s.shot("editor-empty", "Editor for a new landscape project: empty media panel, empty stage, disabled transport, empty sequence.")
        app.pick([fx["clips"]["land1080-30"], fx["clips"]["portrait-rot"], fx["audio"], fx["image"], fx["clips"]["silent"]])
        page.click("button:has-text('Import media')")
        if not wait_until(lambda: media_idle(5), 180):
            raise RuntimeError("import did not finish")
        s.shot("editor-media", "Five assets imported (landscape, rotated portrait, audio with waveform, still image, silent clip) with thumbnails and metadata.")
        s.shot("media-tile-hover", "Hovering a tile shows the add-to-timeline and remove buttons.", element="[data-testid=media-panel]", hover="[data-testid=asset-tile]")
        page.locator("[data-testid=asset-tile] button[aria-label]").first.click()
        s.shot("media-tile-selected", "A selected tile has the accent ring.", element="[data-testid=media-panel]")

        app.pick([fx["dup"], fx["txt"]])
        page.click("button:has-text('Import media')")
        page.wait_for_selector("[data-testid=media-notice]", timeout=30000)
        wait_until(lambda: media_idle(5), 60)
        # The duplicate re-runs land1080-30's thumbnail job, and the decoder does not always land on the same frame
        # of the moving test pattern, so that one thumbnail differs between runs. Mask its picture only.
        s.extra_masks.append(page.locator("[data-testid=asset-tile]", has_text="land1080-30.mp4").locator("img"))
        s.shot("media-notice", "Importing a duplicate and a non-media file shows the notice.", element="[data-testid=media-panel]")
        page.click("[data-testid=media-notice] [aria-label=Dismiss]")
        page.click("[data-testid=filter-audio]")
        s.shot("media-filter-audio", "Audio filter shows only the audio asset.", element="[data-testid=media-panel]")
        page.click("[data-testid=filter-all]")
        page.fill("[data-testid=media-panel] input[placeholder=Search]", "zzz")
        s.shot("media-no-match", "A search with no results says Nothing matches.", element="[data-testid=media-panel]")
        page.fill("[data-testid=media-panel] input[placeholder=Search]", "")

        # ---- timeline and preview
        def add(name):
            tile = page.locator("[data-testid=asset-tile]", has_text=name)
            tile.hover()
            tile.get_by_label("Add to timeline").click()
        add("land1080-30"); add("portrait-rot"); add("tone.m4a")
        focus_body()
        page.keyboard.press("Home")
        wait_until(painted, 20)
        s.shot("editor-timeline-start", "Two clips on V1 and audio on A1, playhead at 0, landscape clip in the preview.")
        p = proj()
        d0 = next(t for t in p["tracks"] if t["type"] == "video")["clips"][0]["durationInFrames"]
        focus_body()
        for _ in range(d0 // 30 + 1):
            page.keyboard.press("Shift+ArrowRight")
        wait_until(lambda: current().startswith("00:0"), 3)
        page.wait_for_timeout(800)
        wait_until(painted, 20)
        s.shot("editor-timeline-portrait", "Playhead inside the second clip: the rotated portrait clip is pillarboxed in the preview.")
        page.locator("[data-testid=clip-block]").nth(1).click(position={"x": 30, "y": 30})
        page.wait_for_selector("[data-testid=inspector] >> text=Picture")
        page.mouse.move(W - 2, H - 2)
        wait_until(painted, 20)
        s.shot("editor-clip-selected", "A clip selected on the timeline: green outline on the clip, its picture and sound in the inspector.")
        s.shot("inspector", "Inspector close-up for a video clip: fit, scale, position, opacity, volume in dB, fades in seconds.", element="[data-testid=inspector]")
        page.keyboard.press("Escape")
        page.click("button[aria-label=Loop]")
        s.shot("transport-loop-on", "Transport with Loop on.", element="[data-testid=stage] >> xpath=..")
        page.click("button[aria-label=Loop]")
        s.shot("sequence-strip", "Sequence strip close-up: ruler, track labels, clip blocks with thumbnails, playhead.", element="[data-testid=sequence]")
        # Line a cut up across tracks: a second tone on A1, the first trimmed to end where V1 cuts
        add("tone.m4a")
        q = proj(); a1 = next(t for t in q["tracks"] if t["type"] == "audio")["clips"]
        page.evaluate("([a, b, d]) => { window.__e2e.patchClip(a, {durationInFrames: d}); window.__e2e.patchClip(b, {startFrame: d}); }", [a1[0]["id"], a1[1]["id"], d0])
        page.mouse.move(W - 2, H - 2)
        page.wait_for_selector("[title='Cuts line up across tracks']")
        s.shot("sequence-interchange", "A V1 cut and an A1 cut on the same frame: the interchange ring spans both tracks.", element="[data-testid=sequence]")

        # ---- dashboard with a project, hover
        page.click("button:has-text('Projects')")
        page.wait_for_selector("[aria-label^='Open ']")
        s.shot("dashboard-cards", "Dashboard with one project card (thumbnail, format badge). The date is masked.")
        s.shot("dashboard-card-hover", "Hovering a card lifts it and shows rename, duplicate and delete.", element="[aria-label^='Open '] >> xpath=..", hover=".group:has(> [aria-label^='Open '])")

        # ---- missing media: delete a source file that is not on the timeline, reopen
        pid = p["id"]
        silent = next(a for a in p["assets"] if "silent" in (a.get("name") or ""))
        (work / "projects" / pid / silent["relativePath"]).unlink()
        page.click("[aria-label^='Open ']")
        page.wait_for_selector("[data-testid=media-panel]")
        page.click("[data-testid=filter-missing]")
        page.wait_for_selector("text=File missing", timeout=20000)
        s.shot("media-missing", "A source file deleted on disk shows as File missing with Relink.", element="[data-testid=media-panel]")
        page.click("button:has-text('Projects')")

        # ---- vertical project
        page.wait_for_selector("[aria-label^='Open ']")
        new_project("Vertical test", "Vertical")
        s.shot("editor-vertical-empty", "Empty 9:16 project: the stage keeps the vertical aspect.")
        page.click("button:has-text('Projects')")

        # ---- recovery banner: tear project.json of the first project; it opens from a snapshot
        page.wait_for_selector("[aria-label='Open Visual test']")
        # Drop the 30s snapshots so it always opens from project.json.prev; otherwise the result depends on when the
        # last snapshot happened to land (open() prefers any snapshot over .prev, see the M4 notes).
        shutil.rmtree(work / "projects" / pid / "recovery", ignore_errors=True)
        (work / "projects" / pid / "project.json").write_text('{"schemaVersion":1,"id":')
        page.click("[aria-label='Open Visual test']")
        page.wait_for_selector("text=restored from a recovery copy", timeout=20000)
        wait_until(painted, 20)
        s.shot("editor-recovered", "Opening a damaged project shows the recovery banner above the editor.")
    except Exception:
        error = traceback.format_exc()[-1500:]
        print(error)
    finally:
        try:
            app.stop()
        finally:
            results = s.results if s else []
            write_report(results, error, work)
    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} shots pass{' (run error)' if error else ''}. Report: {OUT / 'index.html'}")
    sys.exit(1 if failed or error else 0)


main()
