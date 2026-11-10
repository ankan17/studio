#!/usr/bin/env python3
"""Summarise a memory CSV from spike/runs: peak total MB, per-process peak and growth, settled baseline.
Usage: python3 spike/scripts/summarize-run.py spike/runs/<file>.csv [baseline_seconds]
The baseline is the median total over the first N seconds after the first 2s (default 5), so it is a settled
figure rather than the very first startup sample."""
import ast, csv, statistics, sys

path = sys.argv[1]
base_s = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
rows = []
with open(path) as f:
    for r in csv.DictReader(f):
        rows.append((int(r["t_ms"]) / 1000, float(r["total_mb"]), float(r["swap_mb"]), ast.literal_eval(r["processes"])))
base = [r[1] for r in rows if 2 <= r[0] <= 2 + base_s] or [rows[0][1]]
print(f"samples {len(rows)}, duration {rows[-1][0]:.0f}s")
print(f"total MB: baseline(median {base_s:.0f}s after 2s) {statistics.median(base):.0f}, peak {max(r[1] for r in rows):.0f}, end {rows[-1][1]:.0f}")
print(f"swap MB: start {rows[0][2]:.0f}, end {rows[-1][2]:.0f}, growth {rows[-1][2]-rows[0][2]:+.0f} (unreliable if other apps swap)")
procs = {}
for _, _, _, p in rows:
    for k, v in p.items():
        procs.setdefault(k, []).append(v)
for k, v in sorted(procs.items(), key=lambda kv: -max(kv[1])):
    print(f"  {k:<18} first {v[0]:>5.0f}  peak {max(v):>5.0f}  growth {max(v)-v[0]:>+5.0f}")
