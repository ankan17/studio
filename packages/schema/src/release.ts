// Release versions, for the manual "Check for updates" (V1 is unsigned, so there is no auto-update).

/** "v1.2.3", "1.2.3" or "1.2.3-rc.1" to [1, 2, 3], or null. A pre-release suffix is ignored for ordering. */
export function parseVersion(tag: string): [number, number, number] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a higher version than `current`. Anything unparseable is never "newer". */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (b[i]! !== a[i]!) return b[i]! > a[i]!;
  return false;
}
