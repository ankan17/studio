#!/bin/bash
# Builds the V1 disk image from the packaged app: pnpm --filter @studio/desktop package, then this script.
# Unsigned and not notarised: the first launch goes through System Settings, Privacy & Security, Open Anyway (see docs/release-checklist.md).
set -euo pipefail
cd "$(dirname "$0")/.."
APP="apps/desktop/out/Studio-darwin-$(uname -m | sed 's/x86_64/x64/')/Studio.app"
[ -d "$APP" ] || { echo "No $APP. Run: pnpm --filter @studio/desktop package" >&2; exit 1; }
VERSION=$(node -p "require('./apps/desktop/package.json').version")
OUT="apps/desktop/out/Studio-$VERSION-$(uname -m).dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/Studio.app"
# Ad-hoc signature ("-"): the packaged app's seal is broken once Forge edits Info.plist and adds the app code.
codesign --force --deep --sign - "$STAGE/Studio.app"
codesign --verify --deep --strict "$STAGE/Studio.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT"
hdiutil create -volname "Studio $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "$OUT"
