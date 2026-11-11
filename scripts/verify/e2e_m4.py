"""M4 end-to-end: the timeline. Rough-cut a 10-clip vlog by hand with real pointer and keyboard input (trim, split,
delete, move with snapping, multi-select, context menu, tracks, canvas drag), then check the exit bars: fifty undo and
redo steps leave the project identical, and the timeline scrolls at 60fps with 100 clips.
Usage: python3 e2e_m4.py <results.json> [--small]"""
import json, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, REPO, make_fixtures, sh

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
C = Checks("M4")
work = Path(tempfile.mkdtemp(prefix="studio-m4-"))
fx = make_fixtures(work / "fixtures", small=small)
app = App(work / "projects", work)
shots = REPO / "docs" / "reports" / "assets"
shots.mkdir(parents=True, exist_ok=True)
HEAD_H, RULER_H, ROW_H = 36, 26, 60  # Timeline.tsx geometry


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


try:
    page = app.start().page
    page.set_viewport_size({"width": 1440, "height": 900})
    mem = MemorySampler(page)
    C.metrics["machine_ram_gb"] = round(int(sh("sysctl", "-n", "hw.memsize").stdout) / 2**30)
    phases = {}

    def phase(name):
        """Memory at a point in the run: total and the editor tab (the largest Tab process)."""
        mem.sample()
        last = mem.samples[-1] if mem.samples else None
        if last:
            phases[name] = {"total_mb": last["total"], "tab_mb": max([v for k, v in last["procs"].items() if k.startswith("Tab")] or [0])}
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    proj = lambda: page.evaluate("() => window.__e2e.project()")
    sel = lambda: page.evaluate("() => window.__e2e.selection()")
    hist = lambda: page.evaluate("() => window.__e2e.history()")
    V1 = lambda p=None: next(t for t in (p or proj())["tracks"] if t["type"] == "video")
    clips_of = lambda t: t["clips"]
    total_clips = lambda p=None: sum(len(t["clips"]) for t in (p or proj())["tracks"])
    clip_by_id = lambda cid, p=None: next(c for t in (p or proj())["tracks"] for c in t["clips"] if c["id"] == cid)
    track_of = lambda cid, p=None: next(t for t in (p or proj())["tracks"] if any(c["id"] == cid for c in t["clips"]))

    def geom():
        g = page.evaluate("""() => { const s = document.querySelector('[data-testid=sequence]'); const r = s.getBoundingClientRect();
            return {x: r.left, y: r.top, w: r.width, ppf: +s.dataset.ppf, sx: +s.dataset.scrollX, lane: +s.dataset.laneLeft, pad: +s.dataset.pad, rendered: +s.dataset.renderedClips}; }""")
        g["sy"] = page.evaluate("() => window.__e2e.view().scrollY")
        return g

    def fx_(f, g=None):
        g = g or geom()
        return g["x"] + g["lane"] + g["pad"] + f * g["ppf"] - g["sx"]

    def row_y(i, g=None):
        g = g or geom()
        return g["y"] + HEAD_H + RULER_H + i * ROW_H - g["sy"] + ROW_H / 2

    def track_index(tid):
        return [t["id"] for t in proj()["tracks"]].index(tid)

    def clip_box(cid):
        return page.locator(f"[data-clip='{cid}']").bounding_box()

    def drag(x0, y0, x1, y1, steps=12, mods=None):
        if mods:
            page.keyboard.down(mods)
        page.mouse.move(x0, y0)
        page.mouse.down()
        for i in range(1, steps + 1):
            page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        page.mouse.up()
        if mods:
            page.keyboard.up(mods)

    def focus_body():
        page.mouse.click(700, 20)

    def seek(f):
        g = geom()
        page.mouse.click(fx_(f, g), g["y"] + HEAD_H + 13)  # the ruler seeks without touching the selection

    def ph_frame():
        mm, ss, ff = (int(x) for x in page.inner_text("[data-testid=playhead]").strip().split(":"))
        return (mm * 60 + ss) * 30 + ff

    def snapping(on):
        if (page.get_attribute("button[aria-label=Snapping]", "aria-pressed") == "true") != on:
            page.click("button[aria-label=Snapping]")

    # ---- project, import ten phone clips plus music and a still
    page.click("text=New project")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    names = list(fx["clips"].keys())
    app.pick([*fx["clips"].values(), fx["audio"], fx["image"]])
    page.click("button:has-text('Import media')")
    ready = wait_until(lambda: len(proj()["assets"]) == 12 and all((a["type"] == "image" or a.get("durationUs")) and (a["type"] != "video" or a.get("proxyPath")) for a in proj()["assets"]), 240)
    C.check("Ten clips, music and a still imported with proxies", bool(ready))
    wait_until(lambda: page.locator("[data-testid=asset-tile] img").count() >= 11, 30)

    for n in names:
        tile = page.locator("[data-testid=asset-tile]", has_text=n + ".")
        tile.hover()
        tile.get_by_label("Add to timeline").click()
    tile = page.locator("[data-testid=asset-tile]", has_text="tone.m4a"); tile.hover(); tile.get_by_label("Add to timeline").click()
    p = proj()
    v1 = clips_of(V1(p))
    C.check("All ten clips on V1 back to back, music on A1", len(v1) == 10 and all(v1[i]["startFrame"] == v1[i - 1]["startFrame"] + v1[i - 1]["durationInFrames"] for i in range(1, 10)) and [t["type"] for t in p["tracks"]] == ["video", "audio"])
    C.check("Adding clips is undoable (one step per clip)", hist()["size"] == 11, hist())
    page.mouse.move(1400, 880)
    page.wait_for_timeout(800)

    # ---- filmstrips and waveforms are painted on the clips
    def canvas_stats(track_i, cid):
        return page.evaluate("""([ti, cid]) => {
            const row = document.querySelectorAll('[data-testid=track]')[ti]; const c = row.querySelector('canvas');
            const lane = c.getBoundingClientRect(); const b = document.querySelector(`[data-clip='${cid}']`).getBoundingClientRect();
            const k = c.width / lane.width; const x0 = Math.max(0, Math.round((b.left - lane.left + 4) * k)), x1 = Math.min(c.width, Math.round((b.right - lane.left - 4) * k));
            const y0 = Math.round((b.top - lane.top + 18) * k), y1 = Math.round((b.bottom - lane.top - 6) * k);
            const d = c.getContext('2d').getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
            const colors = new Set(); let purple = 0;
            for (let i = 0; i < d.length; i += 4) { colors.add((d[i] >> 4) << 8 | (d[i+1] >> 4) << 4 | (d[i+2] >> 4)); if (d[i] > 120 && d[i+2] > 160 && d[i+1] < 150) purple++; }
            return {colors: colors.size, purple, px: d.length / 4}; }""", [track_i, cid])
    wait_until(lambda: canvas_stats(0, v1[0]["id"])["colors"] > 40, 15)
    film = canvas_stats(0, v1[0]["id"])
    C.check("Filmstrip drawn on video clips (many colours across the clip body)", film["colors"] > 40, film)
    a1 = clips_of(proj()["tracks"][1])[0]
    wait_until(lambda: canvas_stats(1, a1["id"])["purple"] > 50, 15)
    wave = canvas_stats(1, a1["id"])
    C.check("Waveform drawn on the audio clip (audio-line pixels in the wave band)", wave["purple"] > 50, wave)
    page.screenshot(path=str(shots / "M4-timeline.png"))
    C.metrics["screenshots"] = ["M4-timeline.png"]

    phase("ten clips on the timeline")
    start_state = proj()  # the undo/redo exit check rewinds to here
    start_hist = hist()["size"]
    focus_body()
    snapping(False)

    # ---- zoom and scroll
    page.keyboard.press("Meta+Equal"); page.keyboard.press("Meta+Equal"); page.keyboard.press("Meta+Equal")
    g = geom()
    C.check("Cmd+= zooms in (3 steps of 1.5x)", page.evaluate("() => window.__e2e.view().ppf") is not None and g["ppf"] > 3 * page.evaluate("() => window.__e2e.view().fitPpf"), g)
    C.check("Zoomed in, only clips in view are rendered (virtualised)", 0 < g["rendered"] < 10 and page.locator("[data-testid=clip-block]").count() == g["rendered"], f"{g['rendered']} rendered, {page.locator('[data-testid=clip-block]').count()} clip blocks in the DOM of {total_clips()}")
    page.mouse.move(g["x"] + 600, g["y"] + 80)
    for _ in range(10):
        page.mouse.wheel(120, 0)
    page.wait_for_timeout(200)
    g2 = geom()
    C.check("Horizontal wheel scrolls the timeline", g2["sx"] > g["sx"] + 500, f"scrollX {g['sx']:.0f} to {g2['sx']:.0f}")
    page.keyboard.press("Shift+KeyZ")
    page.wait_for_timeout(200)
    C.check("Shift+Z fits the whole edit again", page.evaluate("() => window.__e2e.view().ppf") is None and geom()["sx"] == 0)

    # ---- trim the end of clip 1 and the start of clip 2 with the handles
    g = geom()
    c1, c2 = v1[0], v1[1]
    b = clip_box(c1["id"])
    drag(b["x"] + b["width"] - 3, b["y"] + b["height"] / 2, b["x"] + b["width"] - 3 - 40, b["y"] + b["height"] / 2)
    t1 = clip_by_id(c1["id"])
    want = c1["durationInFrames"] - round(40 / g["ppf"])
    C.check("Dragging a clip's end handle trims its end", abs(t1["durationInFrames"] - want) <= 1 and t1["startFrame"] == 0 and t1["sourceStartUs"] == 0, f"{c1['durationInFrames']} to {t1['durationInFrames']} frames (expected about {want})")
    C.check("Trim keeps source duration in step with frames", abs(t1["sourceDurationUs"] - t1["durationInFrames"] / 30 * 1e6) <= 1)
    b = clip_box(c2["id"])
    drag(b["x"] + 3, b["y"] + b["height"] / 2, b["x"] + 3 + 30, b["y"] + b["height"] / 2)
    t2 = clip_by_id(c2["id"])
    d = t2["startFrame"] - c2["startFrame"]
    C.check("Dragging a clip's start handle trims its start (start and source move together)", d > 0 and t2["durationInFrames"] == c2["durationInFrames"] - d and abs(t2["sourceStartUs"] - d / 30 * 1e6) <= 1, f"start +{d} frames, source in {t2['sourceStartUs']}us")
    b = clip_box(c2["id"])
    drag(b["x"] + 3, b["y"] + b["height"] / 2, b["x"] + 3 - 400, b["y"] + b["height"] / 2)
    t2b = clip_by_id(c2["id"])
    C.check("A trim stops at the start of the source", t2b["sourceStartUs"] == 0 and t2b["startFrame"] == c2["startFrame"], t2b["startFrame"])
    page.keyboard.press("Meta+z")  # back to the trimmed-start version
    b = clip_box(c2["id"])
    drag(b["x"] + 3, b["y"] + b["height"] / 2, b["x"] + 3 - 200, b["y"] + b["height"] / 2)
    C.check("A start trim can be dragged all the way back to the start of the source", clip_by_id(c2["id"])["sourceStartUs"] == 0 and clip_by_id(c2["id"])["startFrame"] == c2["startFrame"], clip_by_id(c2["id"])["sourceStartUs"])
    page.keyboard.press("Meta+z")
    C.check("Cmd+Z undoes the last trim", clip_by_id(c2["id"])["startFrame"] == t2["startFrame"])

    # ---- split at the playhead, then delete the tail
    c3 = clip_by_id(v1[2]["id"])
    mid = c3["startFrame"] + c3["durationInFrames"] // 2
    seek(mid)
    wait_until(lambda: abs(ph_frame() - mid) <= 1, 3)
    focus_body()
    page.locator(f"[data-clip='{c3['id']}']").click(position={"x": 10, "y": 30})
    page.keyboard.press("s")
    v = clips_of(V1())
    i3 = [c["id"] for c in v].index(c3["id"])
    head, tail = v[i3], v[i3 + 1]
    frame_now = ph_frame()
    C.check("S splits the selected clip at the playhead", len(v) == 11 and head["startFrame"] + head["durationInFrames"] == tail["startFrame"] == frame_now and tail["assetId"] == head["assetId"], f"head {head['startFrame']}+{head['durationInFrames']}, tail at {tail['startFrame']}, playhead {frame_now}")
    C.check("The tail continues the source where the head ends", abs(tail["sourceStartUs"] - (head["sourceStartUs"] + head["durationInFrames"] / 30 * 1e6)) <= 1)
    page.locator(f"[data-clip='{tail['id']}']").click(position={"x": 12, "y": 30})
    page.keyboard.press("Backspace")
    C.check("Backspace deletes the selected clip and leaves a gap", len(clips_of(V1())) == 10 and not any(c["id"] == tail["id"] for c in clips_of(V1())))

    # ---- move into the gap with snapping
    snapping(True)
    v = clips_of(V1())
    c4 = v[i3 + 1]  # the clip after the gap
    gap_start = head["startFrame"] + head["durationInFrames"]
    g = geom()
    b = clip_box(c4["id"])
    target_x = fx_(gap_start, g) + 5  # 5px off the edge: snapping pulls it in
    page.mouse.move(b["x"] + 30, b["y"] + 25)
    page.mouse.down()
    for i in range(1, 13):
        page.mouse.move(b["x"] + 30 + (target_x - b["x"]) * i / 12, b["y"] + 25)
    guide = page.locator("[data-testid=snap-guide]").count()
    page.mouse.up()
    m4 = clip_by_id(c4["id"])
    C.check("Dragging a clip near an edge snaps it flush, with a snap guide while dragging", m4["startFrame"] == gap_start and guide == 1, f"start {m4['startFrame']}, gap at {gap_start}, guide {guide}")

    # ---- a drop onto another clip slides to the nearest legal place (no overlap ever)
    v = clips_of(V1())
    a, last = v[5], v[-1]
    last_end = last["startFrame"] + last["durationInFrames"]
    g = geom()
    ba = clip_box(a["id"])
    land = last["startFrame"] + int(last["durationInFrames"] * 0.7)  # start lands inside the last clip, near its end
    drag(ba["x"] + 20, ba["y"] + 25, fx_(land, g) + 20, ba["y"] + 25)
    pv = clips_of(V1())
    overlap = any(pv[i]["startFrame"] < pv[i - 1]["startFrame"] + pv[i - 1]["durationInFrames"] for i in range(1, len(pv)))
    moved = clip_by_id(a["id"])["startFrame"]
    C.check("Dropping a clip onto another slides it to the nearest free place (here, straight after it), never overlapping", not overlap and moved == last_end, f"dropped at about {land}, landed at {moved}, last clip ends at {last_end}")

    # ---- multi-select: Cmd-click two clips, move them together
    v = clips_of(V1())
    last2 = [v[-2]["id"], v[-1]["id"]]
    page.locator(f"[data-clip='{last2[0]}']").click(position={"x": 15, "y": 30})
    page.locator(f"[data-clip='{last2[1]}']").click(position={"x": 15, "y": 30}, modifiers=["Meta"])
    C.check("Cmd-click adds a clip to the selection; the inspector shows the count", sorted(sel()) == sorted(last2) and page.locator("[data-testid=inspector] >> text=2 clips selected").count() == 1)
    before = [clip_by_id(i)["startFrame"] for i in last2]
    snapping(False)
    bx = clip_box(last2[1])
    drag(bx["x"] + 20, bx["y"] + 25, bx["x"] + 20 + 60, bx["y"] + 25)
    after = [clip_by_id(i)["startFrame"] for i in last2]
    C.check("Dragging one of a selection moves the whole selection by the same amount", after[0] - before[0] == after[1] - before[1] > 0, f"{before} to {after}")

    # ---- context menu: duplicate
    n_before = total_clips()
    page.locator(f"[data-clip='{v[0]['id']}']").click(button="right", position={"x": 15, "y": 30})
    menu_ok = page.locator("[data-testid=context-menu]").is_visible()
    page.click("[data-testid=context-menu] >> text=Duplicate")
    C.check("Right-click opens the clip menu; Duplicate adds a copy", menu_ok and total_clips() == n_before + 1 and page.locator("[data-testid=context-menu]").count() == 0)
    dup = sel()[0]
    t = track_of(dup)["clips"]
    no_overlap = all(t[i]["startFrame"] >= t[i - 1]["startFrame"] + t[i - 1]["durationInFrames"] for i in range(1, len(t)))
    C.check("The copy is selected and placed without overlapping", dup != v[0]["id"] and clip_by_id(dup)["assetId"] == v[0]["assetId"] and no_overlap)
    page.keyboard.press("Meta+d")
    C.check("Cmd+D duplicates too", total_clips() == n_before + 2)

    # ---- tracks: add, move a clip there by dragging down, hide, mute, lock, delete
    page.click("button:has-text('Track')")
    page.click("[data-testid=context-menu] >> text=Add video track")
    p = proj()
    C.check("+ Track adds a video track on top", len(p["tracks"]) == 3 and p["tracks"][0]["type"] == "video" and not p["tracks"][0]["clips"])
    new_track = p["tracks"][0]["id"]
    vid = clips_of(p["tracks"][1])[0]["id"]
    b = clip_box(vid)
    g = geom()
    drag(b["x"] + 30, b["y"] + 25, b["x"] + 30, row_y(0, g))
    C.check("Dragging a clip up moves it to the new video track", track_of(vid)["id"] == new_track, track_of(vid)["id"])
    aud = clips_of(proj()["tracks"][2])[0]["id"]
    a0 = clip_by_id(aud)["startFrame"]
    b = clip_box(aud)
    drag(b["x"] + 30, b["y"] + 25, b["x"] + 30 + 40, row_y(0, geom()))
    C.check("An audio clip dragged onto a video track moves in time but stays on its audio track", track_of(aud)["type"] == "audio" and clip_by_id(aud)["startFrame"] > a0, f"start {a0} to {clip_by_id(aud)['startFrame']}")
    page.click("button[aria-label='Hide track V1']")
    C.check("Eye button hides a video track", proj()["tracks"][0]["visible"] is False)
    page.click("button[aria-label='Show track V1']")
    page.click("button[aria-label='Mute track A1']")
    C.check("Speaker button mutes a track", proj()["tracks"][2]["muted"] is True)
    page.click("button[aria-label='Lock track V2']")
    locked_clip = clips_of(proj()["tracks"][1])[0]
    b = clip_box(locked_clip["id"])
    drag(b["x"] + 30, b["y"] + 25, b["x"] + 130, b["y"] + 25)
    page.locator(f"[data-clip='{locked_clip['id']}']").click(position={"x": 15, "y": 30})
    page.keyboard.press("Backspace")
    C.check("A locked track's clips cannot be moved or deleted, and the refusal is explained", clip_by_id(locked_clip["id"])["startFrame"] == locked_clip["startFrame"] and wait_until(lambda: "locked" in page.inner_text("[data-testid=refusal]"), 3) is not None)
    page.click("button[aria-label='Unlock track V2']")
    page.locator("[data-track-head]").first.click(button="right")
    page.click("[data-testid=context-menu] >> text=Move down")
    C.check("Track menu: Move down reorders tracks", proj()["tracks"][1]["id"] == new_track)
    page.locator(f"[data-track-head='{new_track}']").click(button="right")
    page.click("[data-testid=context-menu] >> text=/Delete track/")
    C.check("Track menu: Delete track removes it and its clips", len(proj()["tracks"]) == 2 and not any(c["id"] == vid for t in proj()["tracks"] for c in t["clips"]))
    page.keyboard.press("Meta+z")
    C.check("Undo brings the deleted track back with its clip", len(proj()["tracks"]) == 3 and track_of(vid)["id"] == new_track)

    phase("after trims, splits, moves, tracks")
    # ---- canvas: click the picture to select, drag to position (one undo step)
    focus_body()
    target = clips_of(V1())[0]
    seek(target["startFrame"] + 10)
    page.wait_for_timeout(600)
    page.keyboard.press("Escape")
    pv = page.locator("[data-testid=preview]").bounding_box()
    page.mouse.click(pv["x"] + pv["width"] / 2, pv["y"] + pv["height"] / 2)
    under = [c for t in proj()["tracks"] if t["visible"] for c in t["clips"] if c["startFrame"] <= target["startFrame"] + 10 < c["startFrame"] + c["durationInFrames"] and t["type"] != "audio"]
    C.check("Clicking the picture selects the top clip under the playhead and outlines it", sel() == [under[0]["id"]] and page.locator("[data-testid=canvas-box]").count() == 1, f"selected {sel()}, top {under[0]['id'] if under else None}")
    cid = sel()[0]
    h0 = hist()["size"]
    k = pv["width"] / proj()["width"]
    drag(pv["x"] + pv["width"] / 2, pv["y"] + pv["height"] / 2, pv["x"] + pv["width"] / 2 + 100, pv["y"] + pv["height"] / 2 + 50, steps=20)
    tr = clip_by_id(cid)["transform"]
    C.check("Dragging the picture positions the clip (in project pixels)", abs(tr["x"] - 100 / k) <= 2 and abs(tr["y"] - 50 / k) <= 2, f"x {tr['x']} y {tr['y']} (expected {100 / k:.0f}, {50 / k:.0f})")
    C.check("A whole canvas drag is one undo step", hist()["size"] == h0 + 1, f"{h0} to {hist()['size']}")
    page.keyboard.press("Meta+z")
    C.check("Undo puts the picture back", clip_by_id(cid)["transform"]["x"] == 0)
    page.keyboard.press("Meta+Shift+z")

    phase("after previewing on the canvas")
    # ---- inspector edits are undoable, a slider drag is one step
    h0 = hist()["size"]
    sl = page.locator("#insp-opacity").bounding_box()
    drag(sl["x"] + sl["width"] - 4, sl["y"] + sl["height"] / 2, sl["x"] + sl["width"] * 0.4, sl["y"] + sl["height"] / 2, steps=15)
    op = clip_by_id(cid)["transform"]["opacity"]
    C.check("Inspector slider drag changes the clip and is one undo step", op < 0.6 and hist()["size"] == h0 + 1, f"opacity {op}, steps {h0} to {hist()['size']}")
    focus_body()

    # ---- Exit: rough cut done; fifty more edits by keyboard, then fifty undos and fifty redos
    page.keyboard.press("Escape")
    edits_done = hist()["size"] - start_hist
    v = clips_of(V1())
    fps = 30
    n = 0
    seek_frames = [c["startFrame"] + 7 for c in v]
    while hist()["size"] - start_hist < 50 and n < 120:
        f = seek_frames[n % len(seek_frames)] + (n // len(seek_frames)) * 3
        seek(f)
        focus_body()
        page.keyboard.press("Escape")
        page.keyboard.press("s")  # split everything under the playhead
        n += 1
    C.check("Rough cut made by hand: at least 50 edits recorded since the ten clips were added", hist()["size"] - start_hist >= 50, f"{edits_done} rough-cut edits then {hist()['size'] - start_hist - edits_done} keyboard splits")
    steps = hist()["size"] - start_hist
    end_state = proj()
    t0 = time.time()
    focus_body()
    for _ in range(steps):
        page.keyboard.press("Meta+z")
    undone = proj()
    C.check(f"Exit: {steps} undo steps return the project to exactly where the rough cut started", json.dumps(undone, sort_keys=True) == json.dumps(start_state, sort_keys=True), f"{time.time() - t0:.1f}s")
    for _ in range(steps):
        page.keyboard.press("Meta+Shift+z")
    redone = proj()
    phase("after 50 undos and 50 redos")
    C.check(f"Exit: {steps} redo steps return it exactly to the finished cut", json.dumps(redone, sort_keys=True) == json.dumps(end_state, sort_keys=True))

    # ---- save and reopen
    pid = proj()["id"]
    pdir = work / "projects" / pid
    C.check("The cut is saved to project.json", bool(wait_until(lambda: json.loads((pdir / "project.json").read_text()) == proj(), 10)))
    page.screenshot(path=str(shots / "M4-rough-cut.png"))
    C.metrics["screenshots"].append("M4-rough-cut.png")
    final = proj()
    page.click("button:has-text('Projects')")
    page.click("[aria-label^='Open ']")
    page.wait_for_selector("[data-testid=sequence]")
    C.check("Reopen: the cut is restored exactly; undo history starts fresh", json.dumps(proj(), sort_keys=True) == json.dumps(final, sort_keys=True) and hist()["size"] == 0)

    # ---- Exit: 100 clips scroll at 60fps
    page.evaluate("""() => { const p = window.__e2e.project(); const vids = p.assets.filter(a => a.type !== 'audio');
        for (let i = 0; total() < 100 && i < 500; i++) window.__e2e.dispatch({type: 'addAsset', assetId: vids[i % vids.length].id, clipId: crypto.randomUUID(), trackId: crypto.randomUUID()});
        function total() { return window.__e2e.project().tracks.reduce((n, t) => n + t.clips.length, 0); } }""")
    count = total_clips()
    phase("reopened, 100 clips")
    SCROLL_JS = """(ppf) => new Promise((resolve) => {
        window.__e2e.setView({ppf, scrollX: 0});
        const s = document.querySelector('[data-testid=sequence]'); const times = []; let last = 0; let n = 0; let maxRendered = 0; let maxImages = 0;
        const step = (now) => { if (last) times.push(now - last); last = now;
            if (ppf !== null) window.__e2e.setView({scrollX: window.__e2e.view().scrollX + 24});
            else window.__e2e.setView({ppf: window.__e2e.view().fitPpf * (1.0001 + (n % 2) * 0.0001), scrollX: 0}); // a zoom change every frame repaints every clip
            maxRendered = Math.max(maxRendered, +s.dataset.renderedClips); const c = window.__e2e.mediaCache(); maxImages = Math.max(maxImages, c.images - c.drawn);
            if (++n < 240) requestAnimationFrame(step); else { times.sort((a, b) => a - b);
                resolve({frames: times.length, avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times.at(-1), maxRendered, hiddenImagesHeld: maxImages}); } };
        requestAnimationFrame(step); })"""
    page.wait_for_timeout(500)
    perf = page.evaluate(SCROLL_JS, 2)  # 2px a frame (60px a second), a working zoom for a rough cut
    mem.sample()
    fps_avg = 1000 / perf["avg"]
    C.metrics["scroll_100_clips"] = {k: round(v, 2) if isinstance(v, float) else v for k, v in perf.items()}
    C.check(f"Exit: timeline scrolls at 60fps with {count} clips (each frame re-renders the lanes and repaints the canvases)", count >= 100 and fps_avg >= 55 and perf["p95"] < 20, f"{fps_avg:.1f}fps average, p95 frame {perf['p95']:.1f}ms, worst {perf['max']:.1f}ms over {perf['frames']} frames")
    C.check("Filmstrips that scroll out of view are evicted (at most 4 hidden ones kept)", perf["hiddenImagesHeld"] <= 4, perf)
    fit = page.evaluate(SCROLL_JS, None)  # zoomed out: all 100 clips in view, every frame repaints them all
    C.metrics["repaint_100_clips_fit"] = {k: round(v, 2) if isinstance(v, float) else v for k, v in fit.items()}
    C.check("All 100 clips in view (zoomed to fit): repaints still hold 60fps", 1000 / fit["avg"] >= 55 and fit["p95"] < 20, f"{1000 / fit['avg']:.1f}fps, p95 {fit['p95']:.1f}ms, {fit['maxRendered']} clips rendered")
    page.evaluate("() => window.__e2e.setView({ppf: 2, scrollX: 900})")
    page.wait_for_timeout(400)
    g = geom()
    f0, f1 = (g["sx"] - g["pad"]) / g["ppf"], (g["sx"] + g["w"] - g["lane"]) / g["ppf"]
    in_view = sum(1 for t in proj()["tracks"][:4] for c in t["clips"] if c["startFrame"] < f1 and c["startFrame"] + c["durationInFrames"] > f0)
    dom = page.locator("[data-testid=clip-block]").count()
    C.check("Virtualised: the DOM holds exactly the clips in view, not all 100", abs(dom - in_view) <= 2 and dom < count / 2 and perf["maxRendered"] < count / 2, f"{dom} clip elements for {in_view} clips in view of {count}; at most {perf['maxRendered']} while scrolling")
    page.screenshot(path=str(shots / "M4-100-clips.png"))
    C.metrics["screenshots"].append("M4-100-clips.png")

    phase("after scrolling 100 clips")
    s = mem.summary(); C.metrics["memory"] = s
    C.metrics["memory_by_phase"] = phases
    C.check("Memory bar: editor tab under 600MB (indicative on this machine)", s.get("peak_single_tab_mb", 0) < 600, f"{s.get('peak_single_tab_mb')}MB; by phase {phases}")
    C.check("Memory bar: total under 1.2GB (indicative on this machine)", s.get("peak_total_mb", 0) < 1200, f"{s.get('peak_total_mb')}MB")
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
