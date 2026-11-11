"""M5 end-to-end: editing features. Markers, picture controls (crop, fit, flip, rotation, opacity), audio (volume, mute,
fades, detach), speed with ripple, text clips with presets, and transitions with handle checks, all through real pointer
and keyboard input. The exit is a complete vlog with music, titles and transitions made in the app alone.
Usage: python3 e2e_m5.py <results.json> [--small]"""
import json, subprocess, sys, tempfile, time
from pathlib import Path
from lib import App, Checks, MemorySampler, REPO, make_fixtures, sh

out_json = Path(sys.argv[1])
small = "--small" in sys.argv
C = Checks("M5")
work = Path(tempfile.mkdtemp(prefix="studio-m5-"))
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
    C.metrics["screenshots"] = []
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    proj = lambda: page.evaluate("() => window.__e2e.project()")
    hist = lambda: page.evaluate("() => window.__e2e.history()")
    clip_by_id = lambda cid, p=None: next(c for t in (p or proj())["tracks"] for c in t["clips"] if c["id"] == cid)
    track_of = lambda cid, p=None: next(t for t in (p or proj())["tracks"] if any(c["id"] == cid for c in t["clips"]))

    def shot(name):
        page.mouse.move(1430, 890)
        page.wait_for_timeout(300)
        page.screenshot(path=str(shots / f"M5-{name}.png"))
        C.metrics["screenshots"].append(f"M5-{name}.png")

    def geom():
        return page.evaluate("""() => { const s = document.querySelector('[data-testid=sequence]'); const r = s.getBoundingClientRect();
            return {x: r.left, y: r.top, w: r.width, ppf: +s.dataset.ppf, sx: +s.dataset.scrollX, lane: +s.dataset.laneLeft, pad: +s.dataset.pad}; }""")

    def fx_(f, g=None):
        g = g or geom()
        return g["x"] + g["lane"] + g["pad"] + f * g["ppf"] - g["sx"]

    def drag(x0, y0, x1, y1, steps=12):
        page.mouse.move(x0, y0)
        page.mouse.down()
        for i in range(1, steps + 1):
            page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        page.mouse.up()

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

    def goto(f):
        seek(f)
        for _ in range(40):
            cur = ph_frame()
            if cur == f:
                break
            page.keyboard.press("ArrowRight" if cur < f else "ArrowLeft")
        page.wait_for_timeout(900)
        return ph_frame() == f

    def add_tile(name):
        tile = page.locator("[data-testid=asset-tile]", has_text=name)
        tile.hover()
        tile.get_by_label("Add to timeline").click()

    # ---- project with four clips, music and a still
    page.click("text=New project")
    page.click("button:has-text('Create project')")
    page.wait_for_selector("[data-testid=media-panel]", timeout=30000)
    names = ["land1080-30", "land1080-30b", "land720-24", "portrait-rot"]
    app.pick([*(fx["clips"][n] for n in names), fx["audio"], fx["image"]])
    page.click("button:has-text('Import media')")
    ready = wait_until(lambda: len(proj()["assets"]) == 6 and all((a["type"] == "image" or a.get("durationUs")) and (a["type"] != "video" or a.get("proxyPath")) for a in proj()["assets"]), 240)
    C.check("Four clips, music and a still imported with proxies", bool(ready))
    for n in names:
        add_tile(n + ".")
    add_tile("tone.m4a")
    v1 = [c["id"] for c in proj()["tracks"][0]["clips"]]
    focus_body()
    snapping(True)

    # ---- markers
    focus_body()
    goto(45)
    page.keyboard.press("m")
    p = proj()
    C.check("M adds a marker at the playhead", [m["frame"] for m in p["markers"]] == [45], p["markers"])
    page.click("button[aria-label='Add marker']")
    C.check("A second marker at the same frame is refused with a reason", len(proj()["markers"]) == 1 and "already a marker" in page.inner_text("[data-testid=refusal]"))
    mk = page.locator("[data-testid=marker]").first
    mk.dblclick()
    page.fill("input[aria-label='Marker name']", "Hook")
    page.keyboard.press("Enter")
    C.check("Double-clicking a marker names it", proj()["markers"][0]["label"] == "Hook" and "Hook" in mk.inner_text())
    seek(200)
    first_end = clip_by_id(v1[0])["durationInFrames"]
    b = mk.bounding_box()
    g = geom()
    drag(b["x"] + 7, b["y"] + 13, fx_(first_end, g) + 3, b["y"] + 13)
    C.check("Dragging a marker moves it and it snaps to a cut", proj()["markers"][0]["frame"] == first_end, f"{proj()['markers'][0]['frame']} vs cut at {first_end}")
    mk.click()
    C.check("Clicking a marker moves the playhead to it", wait_until(lambda: ph_frame() == first_end, 3) is not None, ph_frame())
    mk.click(button="right")
    page.click("[role=menu] button:has-text('Rename')")
    page.fill("input[aria-label='Marker name']", "Cut to B-roll")
    page.keyboard.press("Escape")
    C.check("Escape in the name field keeps the old name", proj()["markers"][0]["label"] == "Hook")
    seek(10)
    shot("marker")
    mk.click(button="right")
    page.click("[role=menu] button:has-text('Delete marker')")
    C.check("Delete marker from its menu", proj()["markers"] == [])
    focus_body()
    steps = []
    for _ in range(4):
        page.keyboard.press("Meta+z")
        steps.append([(m["frame"], m["label"]) for m in proj()["markers"]])
    C.check("Marker delete, move, rename and add each undo in turn", steps == [[(first_end, "Hook")], [(45, "Hook")], [(45, "")], []], steps)

    # ---- picture: crop on the canvas and in the inspector, rotation, flip
    cid = v1[0]
    seek(20)
    page.locator(f"[data-clip='{cid}']").click(position={"x": 30, "y": 30})
    asset = next(a for a in proj()["assets"] if a["id"] == clip_by_id(cid)["assetId"])
    pv_shot = lambda: page.locator("[data-testid=preview]").screenshot()
    page.wait_for_timeout(500)
    before = pv_shot()
    page.click("button:has-text('Crop on picture')")
    page.wait_for_selector("[data-testid=crop-mode]")
    r = page.locator("[data-testid=crop-rect]").bounding_box()
    pv = page.locator("[data-testid=preview]").bounding_box()
    C.check("Crop mode shows the whole picture with a crop rectangle", abs(r["width"] - pv["width"]) < 3 and abs(r["width"] / r["height"] - asset["width"] / asset["height"]) < 0.02, r)
    h0 = hist()["size"]
    hw = page.locator("[data-crop=w]").bounding_box()
    drag(hw["x"] + hw["width"] / 2, hw["y"] + hw["height"] / 2, hw["x"] + hw["width"] / 2 + r["width"] * 0.25, hw["y"] + hw["height"] / 2, steps=15)
    cr = clip_by_id(cid).get("crop")
    C.check("Dragging the left crop handle cuts the left quarter (one undo step)", cr and abs(cr["x"] - 0.25) < 0.01 and abs(cr["width"] - 0.75) < 0.01 and hist()["size"] == h0 + 1, f"{cr}, steps {h0} to {hist()['size']}")
    hn = page.locator("[data-crop=ne]").bounding_box()
    drag(hn["x"] + hn["width"] / 2, hn["y"] + hn["height"] / 2, hn["x"] + hn["width"] / 2 - r["width"] * 0.25, hn["y"] + hn["height"] / 2 + r["height"] * 0.1, steps=15)
    cr = clip_by_id(cid)["crop"]
    C.check("Dragging a corner moves two edges", abs(cr["width"] - 0.5) < 0.01 and abs(cr["y"] - 0.1) < 0.01 and abs(cr["height"] - 0.9) < 0.01, cr)
    rr = page.locator("[data-testid=crop-rect]").bounding_box()
    drag(rr["x"] + rr["width"] / 2, rr["y"] + rr["height"] / 2, rr["x"] + rr["width"] / 2 - r["width"], rr["y"] + rr["height"] / 2, steps=15)
    cr = clip_by_id(cid)["crop"]
    C.check("Dragging inside the rectangle moves the crop and stops at the edge of the picture", abs(cr["x"]) < 0.001 and abs(cr["width"] - 0.5) < 0.01, cr)
    shot("crop-mode")
    page.click("button:has-text('Done')")
    page.wait_for_selector("[data-testid=crop-mode]", state="detached")
    box = page.locator("[data-testid=canvas-box]").bounding_box()
    want = cr["width"] * asset["width"] / (cr["height"] * asset["height"])
    C.check("After cropping, the picture box has the kept part's shape", abs(box["width"] / box["height"] - want) < 0.03, f"{box['width'] / box['height']:.3f} vs {want:.3f}")
    page.wait_for_timeout(600)
    cropped = pv_shot()
    C.check("The preview draws the crop (picture changed)", cropped != before)
    page.fill("#insp-crop-right", "10")
    cr2 = clip_by_id(cid)["crop"]
    C.check("Typing a cut for the right edge in the inspector crops it", abs((1 - cr2["x"] - cr2["width"]) - 0.1) < 0.005 and abs(cr2["x"] - cr["x"]) < 0.001, cr2)
    page.click("button[aria-label='Reset crop']")
    C.check("Reset crop shows the whole picture", "crop" not in clip_by_id(cid))
    focus_body()
    page.keyboard.press("Meta+z")
    C.check("Undo brings the crop back", clip_by_id(cid).get("crop") == cr2)
    page.locator(f"[data-clip='{cid}']").click(position={"x": 30, "y": 30})

    page.fill("#insp-rotation", "90")
    t = clip_by_id(cid)["transform"]
    rot_style = page.get_attribute("[data-testid=canvas-box]", "style") or ""
    C.check("Rotation from the inspector turns the clip and its box", t["rotation"] == 90 and "rotate(90deg)" in rot_style, (t["rotation"], rot_style))
    page.wait_for_timeout(600)
    rotated = pv_shot()
    page.click("[aria-label=Flip] button:has-text('Mirrored')")
    page.wait_for_timeout(600)
    flipped = pv_shot()
    C.check("Mirrored flips the picture", clip_by_id(cid)["transform"]["flipH"] is True and flipped != rotated)
    page.click("[aria-label=Flip] button:has-text('Normal')")
    page.wait_for_timeout(600)
    C.check("Normal puts it back, pixel for pixel", pv_shot() == rotated)
    shot("picture-rotated")
    page.fill("#insp-rotation", "0")
    focus_body()

    # ---- audio: detach a clip's sound, mute, volume and fades
    def canvas_purple(cid):
        return page.evaluate("""(cid) => {
            const b = document.querySelector(`[data-clip='${cid}']`); const row = b.closest('[data-testid=track]'); const c = row.querySelector('canvas');
            const lane = c.getBoundingClientRect(); const r = b.getBoundingClientRect(); const k = c.width / lane.width;
            const x0 = Math.max(0, Math.round((r.left - lane.left + 4) * k)), x1 = Math.min(c.width, Math.round((r.right - lane.left - 4) * k));
            const y0 = Math.round((r.top - lane.top + 18) * k), y1 = Math.round((r.bottom - lane.top - 6) * k);
            const d = c.getContext('2d').getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data; let purple = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i+2] > 120 && d[i+2] > d[i+1] + 30) purple++; // wave bars, not the body (49,45,67)
            return purple; }""", cid)
    vid = v1[1]
    page.locator(f"[data-clip='{vid}']").click(position={"x": 30, "y": 30})
    h0 = hist()["size"]
    p0_tracks = proj()["tracks"]
    page.click("[data-testid=inspector] button:has-text('Detach audio')")
    p = proj()
    snd_id = page.evaluate("() => window.__e2e.selection()")[0]
    snd, snd_track = clip_by_id(snd_id, p), track_of(snd_id, p)
    src = clip_by_id(vid, p)
    C.check("Detach audio puts the clip's sound on an audio track at the same time and source, and mutes the video",
            snd_track["type"] == "audio" and snd["assetId"] == src["assetId"] and snd["startFrame"] == src["startFrame"] and snd["sourceStartUs"] == src["sourceStartUs"] and src["muted"] and not snd["muted"],
            f"track {snd_track['type']}, start {snd['startFrame']} vs {src['startFrame']}, video muted {src['muted']}")
    a1 = next(t for t in p0_tracks if t["type"] == "audio")
    a1_free = all(c["startFrame"] + c["durationInFrames"] <= src["startFrame"] or c["startFrame"] >= src["startFrame"] + src["durationInFrames"] for c in a1["clips"])
    want_track = a1["id"] if a1_free else p["tracks"][-1]["id"]
    C.check(f"The sound goes on the first audio track with room ({'A1, free there' if a1_free else 'the music is there, so a new track at the bottom'})",
            snd_track["id"] == want_track and (a1_free or [t["type"] for t in p["tracks"]] == ["video", "audio", "audio"]), [t["type"] for t in p["tracks"]])
    C.check("Detach is one undo step", hist()["size"] == h0 + 1)
    insp = page.inner_text("[data-testid=inspector]")
    C.check("The detached clip shows as sound in the inspector (no Picture section)", "Sound" in insp and "Picture" not in insp)
    tone_id = p["tracks"][1]["clips"][0]["id"]
    C.check("The detached clip draws a waveform (as many wave pixels as the music clip, within half)", bool(wait_until(lambda: canvas_purple(snd_id) > 0.5 * canvas_purple(tone_id) > 0, 10)), f"{canvas_purple(snd_id)} wave pixels, music clip {canvas_purple(tone_id)}")
    b = page.locator(f"[data-clip='{snd_id}']").bounding_box()
    g = geom()
    drag(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, b["x"] + b["width"] / 2 + 30 * g["ppf"], b["y"] + b["height"] / 2 - 2 * ROW_H, steps=15)
    moved = clip_by_id(snd_id)
    C.check("Dragged up onto the video track, the sound stays on an audio track and moves in time", track_of(snd_id)["type"] == "audio" and moved["startFrame"] > snd["startFrame"], f"{track_of(snd_id)['type']}, start {snd['startFrame']} to {moved['startFrame']}")
    shot("detached-audio")
    page.locator(f"[data-clip='{snd_id}']").click(position={"x": 20, "y": 30})
    page.click("[data-testid=inspector] button:has-text('On')")
    C.check("The clip's sound button mutes it", clip_by_id(snd_id)["muted"] is True)
    page.fill("#insp-fadein", "0.5")
    page.fill("#insp-fadeout", "1")
    c = clip_by_id(snd_id)
    C.check("Fade in and out set in seconds land as frames", c["fadeInFrames"] == 15 and c["fadeOutFrames"] == 30, (c["fadeInFrames"], c["fadeOutFrames"]))
    focus_body()
    for _ in range(5):
        page.keyboard.press("Meta+z")
    p = proj()
    C.check("Undoing the fades, mute, move and detach removes the sound clip and unmutes the video", not any(c["id"] == snd_id for t in p["tracks"] for c in t["clips"]) and not clip_by_id(vid, p)["muted"] and len(p["tracks"]) == 2)

    # ---- speed with ripple
    def picture():
        """The composited preview (all layers, as shown), deselected so no outline is drawn, as 160x90 RGB."""
        page.keyboard.press("Escape")
        page.mouse.move(1430, 890)
        page.wait_for_timeout(150)
        png = page.locator("[data-testid=preview]").screenshot()
        return list(subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-vf", "scale=160:90", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], input=png, capture_output=True).stdout)

    diff = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / max(1, len(a))
    sp = v1[2]
    p0 = proj()
    c0 = clip_by_id(sp, p0)
    nxt0 = clip_by_id(v1[3], p0)
    focus_body()
    goto(c0["startFrame"] + 40)
    at_1x_40 = picture()
    goto(c0["startFrame"] + 20)
    at_1x_20 = picture()
    page.locator(f"[data-clip='{sp}']").click(position={"x": 30, "y": 30})
    h0 = hist()["size"]
    sl = page.locator("#insp-speed").bounding_box()
    drag(sl["x"] + sl["width"] / 3, sl["y"] + sl["height"] / 2, sl["x"] + sl["width"] + 30, sl["y"] + sl["height"] / 2, steps=20)  # past the end: the slider stops at 2x
    c = clip_by_id(sp)
    want = round(c0["sourceDurationUs"] / 1e6 * 30 / 2)
    C.check("Dragging the speed slider to 2x halves the clip and keeps its source", c["speed"] == 2 and c["durationInFrames"] == want and c["sourceDurationUs"] == c0["sourceDurationUs"], f"speed {c['speed']}, {c0['durationInFrames']} to {c['durationInFrames']} frames")
    C.check("The next clip on the track ripples in by the same amount", clip_by_id(v1[3])["startFrame"] == nxt0["startFrame"] - (c0["durationInFrames"] - c["durationInFrames"]), f"{nxt0['startFrame']} to {clip_by_id(v1[3])['startFrame']}")
    C.check("Clips on other tracks do not move", [x["startFrame"] for x in proj()["tracks"][1]["clips"]] == [x["startFrame"] for x in p0["tracks"][1]["clips"]])
    C.check("A whole slider drag is one undo step", hist()["size"] == h0 + 1, f"{h0} to {hist()['size']}")
    C.check("The timeline labels the clip 2×", "2×" in page.inner_text(f"[data-clip='{sp}']"))
    focus_body()
    goto(c0["startFrame"] + 20)
    at_2x_20 = picture()
    d_same, d_other = diff(at_2x_20, at_1x_40), diff(at_2x_20, at_1x_20)
    C.check("At 2x the preview shows source frame 40 at clip frame 20", d_same < d_other / 4, f"mean difference to 1x frame 40: {d_same:.2f}, to 1x frame 20: {d_other:.2f}")
    shot("speed")
    page.keyboard.press("Meta+z")
    C.check("Undo restores the speed and the following clip", clip_by_id(sp)["speed"] == 1 and clip_by_id(v1[3])["startFrame"] == nxt0["startFrame"])

    # ---- titles: add, style, animate, place on the canvas
    focus_body()
    page.keyboard.press("Escape")
    goto(30)
    h0 = hist()["size"]
    page.keyboard.press("t")
    p = proj()
    tid = page.evaluate("() => window.__e2e.selection()")[0]
    tc, tt = clip_by_id(tid, p), track_of(tid, p)
    C.check("T adds a 3-second title at the playhead on a new text track on top, selected", tt["type"] == "text" and p["tracks"][0]["id"] == tt["id"] and tc["startFrame"] == 30 and tc["durationInFrames"] == 90 and hist()["size"] == h0 + 1, (tt["type"], tc["startFrame"], tc["durationInFrames"]))
    C.check("The text track is tagged T1 and the clip shows its words", "T1" in page.inner_text(f"[data-track='{tt['id']}']") and "Title" in page.inner_text(f"[data-clip='{tid}']"))
    page.fill("textarea[aria-label='Title text']", "নমস্কার\nWelcome back")
    C.check("Typing in the inspector changes the title", clip_by_id(tid)["text"]["content"] == "নমস্কার\nWelcome back")
    page.fill("#insp-size", "110")
    page.fill("#insp-color", "#ffd34d")
    page.click("[aria-label=Box] button:text-is('On')")
    page.fill("#insp-outline", "3")
    page.click("[aria-label=Shadow] button:has-text('Soft')")
    page.click("[aria-label=Alignment] button:has-text('Left')")
    t = clip_by_id(tid)["text"]
    C.check("Size, colour, box, outline, shadow and alignment are set from the inspector",
            t["fontSize"] == 110 and t["color"] == "#ffd34d" and t.get("background") == "#000000" and t.get("stroke", {}).get("width") == 3 and "shadow" in t and t["alignment"] == "left", t)
    el = "[data-text-clip='%s']" % tid
    style = page.evaluate("(s) => { const e = document.querySelector(s); const c = getComputedStyle(e); return {font: c.fontFamily, size: c.fontSize, color: c.color, bg: c.backgroundColor, stroke: c.webkitTextStrokeWidth, shadow: c.textShadow, align: c.textAlign}; }", el)
    C.check("The preview draws the title with that style", "110px" == style["size"] and style["color"] == "rgb(255, 211, 77)" and style["bg"] == "rgb(0, 0, 0)" and style["stroke"] == "3px" and style["shadow"] != "none" and style["align"] == "left", style)
    C.check("Bengali is shaped with the bundled Noto Sans Bengali", page.evaluate("async () => { await document.fonts.ready; return document.fonts.check('110px \"Noto Sans Bengali\"', 'নমস্কার'); }") and "Noto Sans Bengali" in style["font"], style["font"])
    page.select_option("#insp-font", "Bebas Neue")
    C.check("Changing the font to Bebas Neue", clip_by_id(tid)["text"]["fontFamily"] == "Bebas Neue" and "Bebas Neue" in page.evaluate("(s) => getComputedStyle(document.querySelector(s)).fontFamily", el))
    page.select_option("#insp-font", "Noto Sans Bengali")
    page.wait_for_timeout(400)
    shot("title")
    insp_overflow = page.evaluate("() => { const i = document.querySelector('[data-testid=inspector]'); return i.scrollWidth - i.clientWidth; }")
    C.check("The inspector's title controls fit its width (no sideways overflow)", insp_overflow <= 0, f"{insp_overflow}px")

    # animation in the preview
    page.select_option("#insp-enterPreset", "typewriter")
    page.select_option("#insp-exitPreset", "fade")
    C.check("Enter and exit animations are set", clip_by_id(tid)["text"]["enterPreset"] == "typewriter" and clip_by_id(tid)["text"]["exitPreset"] == "fade")
    focus_body()
    typed = lambda: page.evaluate("(s) => { const e = document.querySelector(s); const hidden = e.querySelector('span'); return {shown: e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : '', hidden: hidden ? hidden.textContent : ''}; }", el)
    goto(30 + 6)
    early = typed()
    content = clip_by_id(tid)["text"]["content"]
    C.check("Typewriter: early in the title only the first letters show, whole graphemes, the rest held in place hidden", 0 < len(early["shown"]) < len(content) and early["shown"] + early["hidden"] == content and early["shown"] in ("ন", "নম", "নমস্", "নমস্কা", "নমস্কার"), early)
    goto(30 + 50)
    C.check("By the middle of the title everything is typed", typed() == {"shown": content, "hidden": ""})
    op = lambda: float(page.evaluate("(s) => getComputedStyle(document.querySelector(s).parentElement).opacity", el))
    mid_op = op()
    goto(30 + 88)
    C.check("Fade out: the title fades near its end", mid_op == 1 and op() < 0.3, (mid_op, op()))

    # place it on the canvas
    goto(30 + 50)
    page.keyboard.press("Escape")
    r = page.locator(el).bounding_box()
    page.mouse.click(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2)
    C.check("Clicking the title on the picture selects it and outlines it", page.evaluate("() => window.__e2e.selection()") == [tid] and page.locator("[data-testid=canvas-box]").count() == 1)
    bx = page.locator("[data-testid=canvas-box]").bounding_box()
    C.check("The outline matches the drawn title", abs(bx["width"] - r["width"]) < 4 and abs(bx["height"] - r["height"]) < 4, (bx, r))
    pv = page.locator("[data-testid=preview]").bounding_box()
    k = pv["width"] / proj()["width"]
    drag(r["x"] + r["width"] / 2, r["y"] + r["height"] / 2, r["x"] + r["width"] / 2, r["y"] + r["height"] / 2 + 120, steps=15)
    ty = clip_by_id(tid)["transform"]["y"]
    C.check("Dragging the title on the picture moves it (lower third)", abs(ty - 120 / k) <= 2, f"y {ty} (expected {120 / k:.0f})")
    page.wait_for_timeout(300)
    bx2 = page.locator("[data-testid=canvas-box]").bounding_box()
    C.check("The outline follows the moved title", abs(bx2["y"] - bx["y"] - 120) < 4, (bx["y"], bx2["y"]))
    shot("title-placed")
    page.locator("textarea[aria-label='Title text']").click()
    page.keyboard.press("End")
    page.keyboard.type("!")
    page.keyboard.press("Meta+z")
    C.check("Cmd+Z in the text field undoes through the history", clip_by_id(tid)["text"]["content"] == content, clip_by_id(tid)["text"]["content"])
    focus_body()

    # ---- transitions: centred on the cut, with handles
    A, B = v1[0], v1[1]
    dispatch = lambda cmd: page.evaluate("(c) => window.__e2e.dispatch(c)", cmd)
    # setup through the timeline's own commands: leave 20 frames of handle on each side of the A|B cut
    dispatch({"type": "trimClip", "clipId": A, "edge": "end", "deltaFrames": -20})
    dispatch({"type": "trimClip", "clipId": B, "edge": "start", "deltaFrames": 20})
    gap = clip_by_id(B)["startFrame"] - (clip_by_id(A)["startFrame"] + clip_by_id(A)["durationInFrames"])
    dispatch({"type": "moveClips", "clipIds": v1[1:], "deltaFrames": -gap})
    cut = clip_by_id(B)["startFrame"]
    C.check("Setup: A and B touch, with 20 frames of untrimmed footage each side of the cut", cut == clip_by_id(A)["startFrame"] + clip_by_id(A)["durationInFrames"] and clip_by_id(B)["sourceStartUs"] > 0)

    focus_body()
    page.locator(f"[data-clip='{v1[2]}']").click(position={"x": 30, "y": 30})
    C.check("At a cut with no spare footage the transition buttons are off and the inspector says why",
            page.locator("[aria-label=Transition] button:has-text('Dissolve')").is_disabled() and "footage" in page.inner_text("[data-testid=transition-reason]"))
    goto(cut - 4)
    before_a = picture()
    goto(cut + 30)
    after_b = picture()
    page.locator(f"[data-clip='{A}']").click(position={"x": 30, "y": 30})
    h0 = hist()["size"]
    page.click("[aria-label=Transition] button:has-text('Dissolve')")
    t = clip_by_id(A).get("transitionOut")
    C.check("Dissolve from the inspector adds a half-second transition into the next clip (one undo step)", t == {"kind": "fade", "durationInFrames": 15} and hist()["size"] == h0 + 1, t)
    pill = page.locator(f"[data-transition='{A}']").bounding_box()
    g = geom()
    C.check("The timeline draws the transition centred on the cut", pill is not None and abs((pill["x"] + pill["width"] / 2) - fx_(cut, g)) < 0.5 * g["ppf"] + 2 and abs(pill["width"] - 15 * g["ppf"]) < 3, pill)
    focus_body()
    goto(cut - 4)
    mid = picture()
    C.check("Inside the dissolve the preview blends the two clips (differs from A alone)", diff(mid, before_a) > 1.0, f"difference to A alone {diff(mid, before_a):.2f}")
    goto(cut + 30)
    C.check("After the transition the picture is B as before", diff(picture(), after_b) < 0.3, f"{diff(picture(), after_b):.2f}")
    goto(cut - 1)
    shot("transition-dissolve")
    page.locator(f"[data-clip='{A}']").click(position={"x": 30, "y": 30})
    page.click("[aria-label=Transition] button:has-text('Wipe')")
    page.fill("#insp-transition", "40")
    t = clip_by_id(A)["transitionOut"]
    C.check("Wipe, lengthened to the most the handles allow (40 frames)", t == {"kind": "wipe", "durationInFrames": 40}, t)
    sl = page.locator("#insp-transition").bounding_box()
    drag(sl["x"] + sl["width"] / 2, sl["y"] + sl["height"] / 2, sl["x"] + sl["width"] + 60, sl["y"] + sl["height"] / 2)
    C.check("The length stops at what the footage allows", clip_by_id(A)["transitionOut"]["durationInFrames"] == 40)
    focus_body()
    goto(cut)
    shot("transition-wipe")
    page.locator(f"[data-clip='{A}']").click(position={"x": 30, "y": 30})
    page.click("[aria-label=Transition] button:has-text('Slide')")
    C.check("Slide", clip_by_id(A)["transitionOut"]["kind"] == "slide")
    focus_body()
    goto(cut)
    shot("transition-slide")
    page.locator(f"[data-clip='{A}']").click(position={"x": 30, "y": 30})
    page.click("[aria-label=Transition] button:has-text('Dissolve')")
    page.fill("#insp-transition", "15")
    focus_body()
    p_before = proj()
    dispatch({"type": "moveClips", "clipIds": v1[1:], "deltaFrames": 15})
    C.check("Pulling the clips apart removes the transition", "transitionOut" not in clip_by_id(A))
    page.keyboard.press("Meta+z")
    C.check("Undo brings it back with the clips", clip_by_id(A).get("transitionOut") == clip_by_id(A, p_before)["transitionOut"])

    # ---- Exit: a complete vlog with music, titles and transitions, in the app alone
    Cc = v1[2]
    dispatch({"type": "trimClip", "clipId": B, "edge": "end", "deltaFrames": -15})
    dispatch({"type": "trimClip", "clipId": Cc, "edge": "start", "deltaFrames": 15})
    gap = clip_by_id(Cc)["startFrame"] - (clip_by_id(B)["startFrame"] + clip_by_id(B)["durationInFrames"])
    dispatch({"type": "moveClips", "clipIds": v1[2:], "deltaFrames": -gap})
    focus_body()
    page.locator(f"[data-clip='{B}']").click(position={"x": 30, "y": 30})
    page.click("[aria-label=Transition] button:has-text('Slide')")
    add_tile("tone.m4a")  # a second pass of the music
    music = [c["id"] for t in proj()["tracks"] if t["type"] == "audio" for c in t["clips"]]
    page.locator(f"[data-clip='{music[-1]}']").click(position={"x": 30, "y": 30})
    page.fill("#insp-fadeout", "1")
    total = max(c["startFrame"] + c["durationInFrames"] for t in proj()["tracks"] for c in t["clips"])
    focus_body()
    goto(clip_by_id(v1[3])["startFrame"] + 5)
    page.keyboard.press("t")
    end_title = page.evaluate("() => window.__e2e.selection()")[0]
    page.fill("textarea[aria-label='Title text']", "Thanks for watching")
    page.select_option("#insp-enterPreset", "pop")
    page.select_option("#insp-exitPreset", "fade")
    focus_body()
    page.keyboard.press("m")
    p = proj()
    v_track = next(t for t in p["tracks"] if t["type"] == "video")
    kinds = sorted(c["transitionOut"]["kind"] for c in v_track["clips"] if c.get("transitionOut"))
    titles = [c for t in p["tracks"] if t["type"] == "text" for c in t["clips"]]
    C.check("Exit: the vlog has four clips with a dissolve and a slide, two titles with animations, music with a fade out, and markers",
            len(v_track["clips"]) == 4 and kinds == ["fade", "slide"] and len(titles) == 2 and all(c["text"].get("enterPreset") not in (None, "none") for c in titles)
            and clip_by_id(music[-1], p)["fadeOutFrames"] == 30 and len(p["markers"]) >= 1, {"transitions": kinds, "titles": len(titles), "markers": len(p["markers"])})
    shot("vlog")

    pid = p["id"]
    pdir = work / "projects" / pid
    C.check("Exit: the vlog is saved to project.json (schema-valid, every new field included)", bool(wait_until(lambda: json.loads((pdir / "project.json").read_text()) == proj(), 10)))
    final = proj()
    sample_frames = [clip_by_id(B, final)["startFrame"] - 3, titles[0]["startFrame"] + 45, clip_by_id(v1[3], final)["startFrame"] + 40]
    pics = []
    for f in sample_frames:
        goto(f)
        pics.append(picture())
    page.click("button:has-text('Projects')")
    page.click("[aria-label^='Open ']")
    page.wait_for_selector("[data-testid=sequence]")
    C.check("Exit: reopening restores the vlog exactly", json.dumps(proj(), sort_keys=True) == json.dumps(final, sort_keys=True))
    page.wait_for_timeout(1500)
    again = []
    for f in sample_frames:
        goto(f)
        again.append(picture())
    diffs = [round(diff(a, b), 2) for a, b in zip(pics, again)]
    C.check("Exit: after reopening the preview draws the same frames (mid-dissolve, a title, a plain frame)", all(d < 0.5 for d in diffs), diffs)

    # play it through, start to end
    if page.get_attribute("button[aria-label=Loop]", "aria-pressed") == "true":
        page.click("button[aria-label=Loop]")
    focus_body()
    page.keyboard.press("Home")
    errors_before = len(page_errors)
    t0 = time.time()
    page.keyboard.press("Space")
    peak = {"total": 0, "tab": 0}
    furthest = 0
    while time.time() - t0 < total / 30 + 15:
        furthest = max(furthest, ph_frame())
        mem.sample()
        last = mem.samples[-1] if mem.samples else None
        if last:
            peak["total"] = max(peak["total"], last["total"])
            peak["tab"] = max(peak["tab"], max([v for k, v in last["procs"].items() if k.startswith("Tab")] or [0]))
        if page.get_attribute("[data-testid=play]", "aria-pressed") != "true" and time.time() - t0 > 2:
            break
        time.sleep(0.5)
    took = time.time() - t0
    C.check("Exit: the whole vlog plays to the end in real time", furthest >= total - 20 and took < total / 30 + 3 and len(page_errors) == errors_before, f"reached frame {furthest} of {total} (polled every 0.5s), stopped after {took:.1f}s for {total / 30:.1f}s of video")
    page.wait_for_timeout(500)
    C.check("Playback that reaches the end rests on the last frame (not back on frame 0)", ph_frame() == total - 1, f"playhead at {ph_frame()}, last frame {total - 1}")
    C.metrics["playback_peak_mb"] = peak
    C.check("Memory while playing the vlog: editor tab under 600MB (indicative on this machine)", 0 < peak["tab"] < 600, peak)
    C.check("Memory while playing the vlog: total under 1.2GB (indicative on this machine)", 0 < peak["total"] < 1200, peak)

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
