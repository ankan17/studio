#!/usr/bin/env python3
"""Draws the Studio app icon (icon.png and icon.icns): the dashboard's metro-line mark, a gold line between two station
rings, on the ground colour (DESIGN.md: ground #0b0e15, gold #deaf44, ink #eaedf2). Pure Python, no image library.
Run from this folder: python3 make-icon.py"""
import math, struct, subprocess, zlib
from pathlib import Path

N = 1024
GROUND, GOLD, INK = (11, 14, 21), (222, 175, 68), (234, 237, 242)


def cov(d):  # anti-aliased coverage from a signed distance in pixels (negative is inside)
    return max(0.0, min(1.0, 0.5 - d))


def sd_round_rect(x, y, half, r):
    qx, qy = abs(x - N / 2) - (half - r), abs(y - N / 2) - (half - r)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def pixel(x, y):
    plate = cov(sd_round_rect(x, y, N * 0.45, N * 0.2))  # macOS icons sit inside a margin
    if plate == 0:
        return (0, 0, 0, 0)
    c = GROUND
    x0, x1, yc = N * 0.27, N * 0.73, N / 2
    # the line: a capsule
    t = min(max((x - x0) / (x1 - x0), 0), 1)
    c = mix(c, GOLD, cov(math.hypot(x - (x0 + t * (x1 - x0)), y - yc) - N * 0.045))
    for cx in (x0, x1):  # the stations: a ground disc with an ink ring
        d = math.hypot(x - cx, y - yc)
        c = mix(c, INK, cov(d - N * 0.115))
        c = mix(c, GROUND, cov(d - N * 0.075))
    return (*(int(round(v)) for v in c), int(round(255 * plate)))


rows = []
for y in range(N):
    row = bytearray([0])
    for x in range(N):
        row += bytes(pixel(x + 0.5, y + 0.5))
    rows.append(bytes(row))
raw = b"".join(rows)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


here = Path(__file__).parent
(here / "icon.png").write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
iconset = here / "icon.iconset"
iconset.mkdir(exist_ok=True)
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = size * scale
        out = iconset / f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
        subprocess.run(["sips", "-z", str(px), str(px), str(here / "icon.png"), "--out", str(out)], check=True, capture_output=True)
subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(here / "icon.icns")], check=True)
for f in iconset.iterdir():
    f.unlink()
iconset.rmdir()
print("wrote icon.png and icon.icns")
