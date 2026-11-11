#!/usr/bin/env python3
"""Verify a milestone and write its report.

    python3 scripts/verify/verify.py M2            # full run: typecheck, lint, tests, end-to-end in the real app
    python3 scripts/verify/verify.py M2 --small    # shorter synthetic clips (quick check)
    python3 scripts/verify/verify.py M2 --skip-e2e # static checks only

The report is written to docs/reports/<milestone>.md. Each milestone adds scripts/verify/e2e_<milestone>.py, which writes
a results JSON (checks with evidence, metrics, notes). Hand-written notes for the milestone (what could not be
automated, open issues) live in docs/reports/<milestone>.notes.md and are appended to the report.
"""
import json, platform, subprocess, sys, tempfile, time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def run_step(name, cmd, cwd=REPO):
    t = time.time()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    tail = "\n".join((p.stdout + p.stderr).strip().splitlines()[-6:])
    print(f"[{'PASS' if p.returncode == 0 else 'FAIL'}] {name} ({time.time() - t:.0f}s)", flush=True)
    return {"name": name, "ok": p.returncode == 0, "detail": f"{time.time() - t:.0f}s", "tail": tail}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    ms = args[0].upper()
    results = {"static": [], "e2e": None}
    results["static"].append(run_step("pnpm typecheck", ["pnpm", "typecheck"]))
    results["static"].append(run_step("pnpm lint", ["pnpm", "lint"]))
    results["static"].append(run_step("pnpm test (schema, store, import, crash)", ["pnpm", "test"]))
    if "--skip-e2e" not in flags:
        script = HERE / f"e2e_{ms.lower()}.py"
        out = Path(tempfile.mkdtemp()) / "e2e.json"
        subprocess.run([sys.executable, str(script), str(out), *[f for f in flags if f == "--small"]], cwd=HERE)
        results["e2e"] = json.loads(out.read_text()) if out.exists() else None
    write_report(ms, results, flags)
    bad = [r for r in results["static"] if not r["ok"]] + [c for c in (results["e2e"] or {"checks": []})["checks"] if not c["ok"]]
    sys.exit(1 if bad or ("--skip-e2e" not in flags and not results["e2e"]) else 0)


def git(*a):
    return subprocess.run(["git", *a], cwd=REPO, capture_output=True, text=True).stdout.strip()


def write_report(ms, results, flags):
    e2e = results["e2e"]
    lines = [f"# {ms} verification report", ""]
    lines += [f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} by `scripts/verify/verify.py {ms}{' ' + ' '.join(flags) if flags else ''}`.",
              f"Commit `{git('rev-parse', '--short', 'HEAD')}`{' (uncommitted changes present)' if git('status', '--short') else ''} · {platform.platform()} · "
              f"{(e2e or {}).get('metrics', {}).get('machine_ram_gb', '?')}GB RAM. The 8GB target Mac is a separate run; memory figures from other machines are indicative only.", ""]
    all_checks = results["static"] + (e2e["checks"] if e2e else [])
    passed = sum(c["ok"] for c in all_checks)
    lines += [f"**Result: {passed}/{len(all_checks)} checks passed.**" + ("" if e2e else " (end-to-end was skipped)"), ""]
    lines += ["## Static checks", "", "| Check | Result | Detail |", "|---|---|---|"]
    for r in results["static"]:
        lines.append(f"| {r['name']} | {'pass' if r['ok'] else '**FAIL**'} | {r['detail']} |")
        if not r["ok"]:
            lines += ["", "```", r["tail"], "```", ""]
    if e2e:
        lines += ["", "## End-to-end checks (real Electron app, driven over CDP)", "", "| Check | Result | Evidence |", "|---|---|---|"]
        for c in e2e["checks"]:
            lines.append(f"| {c['name']} | {'pass' if c['ok'] else '**FAIL**'} | {c['detail'].replace('|', '/').replace(chr(10), ' ')[:300]} |")
        m = {k: v for k, v in e2e["metrics"].items() if k != "memory"}
        if m or e2e["metrics"].get("memory"):
            lines += ["", "## Measurements", ""]
            lines += [f"- {k.replace('_', ' ')}: {v}" for k, v in m.items()]
            for k, v in (e2e["metrics"].get("memory") or {}).items():
                lines.append(f"- memory {k.replace('_', ' ')}: {v}")
        for shot in e2e["metrics"].get("screenshots", []):
            lines += ["", f"![{shot}](assets/{shot})"]
        if e2e["notes"]:
            lines += ["", "## Artifacts", ""] + [f"- `{n}`" for n in e2e["notes"]]
    notes = REPO / "docs" / "reports" / f"{ms}.notes.md"
    if notes.exists():
        lines += ["", notes.read_text().strip()]
    out = REPO / "docs" / "reports" / f"{ms}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print(f"\nReport: {out}")


main()
