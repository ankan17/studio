"""Shared pieces for milestone verification: launching the app, driving it over CDP, fixtures, checks, memory sampling."""
import json, os, re, shutil, signal, subprocess, tempfile, time, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DESKTOP = REPO / "apps" / "desktop"
PORT = 9333


class Checks:
    """Collects named pass/fail results with the evidence that backs them. Written to JSON for the report."""

    def __init__(self, milestone):
        self.milestone, self.items, self.metrics, self.notes = milestone, [], {}, []

    def check(self, name, ok, detail=""):
        self.items.append({"name": name, "ok": bool(ok), "detail": str(detail)})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""), flush=True)
        return ok

    def save(self, path):
        Path(path).write_text(json.dumps({"milestone": self.milestone, "checks": self.items, "metrics": self.metrics, "notes": self.notes}, indent=2))


def sh(*args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def ffprobe(path):
    out = sh("ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)).stdout
    return json.loads(out or "{}")


# ---- fixtures (generated locally, never committed)
def make_fixtures(d: Path, small=False):
    """10 phone-like clips plus audio, image, a byte-identical duplicate and a non-media file. Returns a dict of paths."""
    d.mkdir(parents=True, exist_ok=True)
    secs = 3 if small else 6

    def gen(name, size, fps, vcodec, extra=(), audio=True, rot=None):
        out = d / name
        a = ["-f", "lavfi", "-i", f"sine=frequency={300 + len(name) * 20}:sample_rate=48000"] if audio else []
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate={fps}", *a, "-t", str(secs), "-c:v", *vcodec, *extra]
        if audio:
            cmd += ["-c:a", "aac", "-b:a", "128k"]
        tmp = d / ("tmp-" + name) if rot else out
        sh(*cmd, str(tmp))
        if rot:  # iPhone style: coded landscape, rotation stored as metadata
            sh("ffmpeg", "-y", "-v", "error", "-display_rotation:v", str(rot), "-i", str(tmp), "-c", "copy", str(out))
            tmp.unlink()
        return out

    h264 = ["libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast"]
    clips = {
        "land1080-30": gen("land1080-30.mp4", "1920x1080", 30, h264),
        "land1080-30b": gen("land1080-30b.mp4", "1920x1080", 30, h264),
        "land1080-60": gen("land1080-60.mov", "1920x1080", 60, h264),
        "land720-24": gen("land720-24.mp4", "1280x720", 24, h264),
        "land4k-30": gen("land4k-30.mp4", "3840x2160", 30, h264),
        "portrait-rot": gen("portrait-rot.mov", "1920x1080", 30, h264, rot=90),
        "portrait-rot2": gen("portrait-rot2.mov", "1920x1080", 30, h264, rot=90),
        "silent": gen("silent.mp4", "1280x720", 30, h264, audio=False),
        "hevc10-hdr": gen("hevc10-hdr.mov", "1920x1080", 30, ["libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-preset", "ultrafast"],
                          extra=["-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error"]),
        "hevc8": gen("hevc8.mov", "1920x1080", 30, ["hevc_videotoolbox", "-tag:v", "hvc1", "-b:v", "6M"]),
    }
    m4a = d / "tone.m4a"
    sh("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "4", "-c:a", "aac", str(m4a))
    png = d / "still.png"
    sh("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1600x900", "-frames:v", "1", str(png))
    dup = d / "copy-of-land1080-30.mp4"
    shutil.copyfile(clips["land1080-30"], dup)
    txt = d / "notes.txt"
    txt.write_text("not media")
    return {"clips": clips, "audio": m4a, "image": png, "dup": dup, "txt": txt}


# ---- app lifecycle
class App:
    def __init__(self, projects_dir: Path, workdir: Path):
        self.projects_dir, self.workdir = projects_dir, workdir
        self.proc = self.pw = self.browser = self.page = None
        self.pick_file = workdir / "pick.json"
        self.keepalive = None

    def start(self):
        env = dict(os.environ, STUDIO_PROJECTS_DIR=str(self.projects_dir), STUDIO_E2E="1", STUDIO_E2E_PICK_FILE=str(self.pick_file))
        self.pick_file.write_text("[]")
        log = open(self.workdir / "app.log", "w")
        # forge exits when stdin closes, so hand it a stdin that stays open
        self.keepalive = subprocess.Popen(["sleep", "3000"], stdout=subprocess.PIPE)
        self.proc = subprocess.Popen(["npx", "electron-forge", "start", "--", f"--remote-debugging-port={PORT}"], cwd=DESKTOP, env=env,
                                     stdin=self.keepalive.stdout, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                self.browser = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
                for ctx in self.browser.contexts:
                    for p in ctx.pages:
                        if "localhost:5173" in p.url and "worker=media" not in p.url:
                            self.page = p
                if self.page:
                    self.page.wait_for_selector("text=Projects", timeout=60000)
                    return self
            except Exception:
                self.browser = None
                time.sleep(2)
        raise RuntimeError("app did not start; see " + str(self.workdir / "app.log"))

    def stop(self):
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        if self.pw:
            self.pw.stop()
        if self.proc:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        if self.keepalive:
            self.keepalive.kill()
        sh("pkill", "-f", "Electron.*remote-debugging-port=%d" % PORT)
        time.sleep(1)

    def pick(self, paths):
        self.pick_file.write_text(json.dumps([str(p) for p in paths]))


class MemorySampler:
    """Polls the in-app HUD (it shows the main process's own measurement of every Electron process) once a second."""

    def __init__(self, page):
        self.page, self.samples = page, []

    def sample(self):
        # the HUD shows total and peak; swap and per-process figures live in its tooltip
        txt = self.page.evaluate("() => { const h = document.querySelector('[data-testid=hud]'); return h ? h.innerText + '\\n' + (h.title || '') : ''; }")
        m = re.search(r"Memory (\d+) MB", txt)
        if not m:
            return
        procs = {}
        for name, pid, mb in re.findall(r"(\w+):(\d+) (\d+)", txt):
            procs[f"{name}:{pid}"] = int(mb)
        self.samples.append({"t": time.time(), "total": int(m.group(1)), "procs": procs})

    def summary(self):
        if not self.samples:
            return {}
        peak_tab = 0
        for s in self.samples:
            for k, v in s["procs"].items():
                if k.startswith("Tab"):
                    peak_tab = max(peak_tab, v)
        return {"peak_total_mb": max(s["total"] for s in self.samples), "first_total_mb": self.samples[0]["total"], "peak_single_tab_mb": peak_tab, "samples": len(self.samples)}
