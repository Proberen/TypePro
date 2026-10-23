#!/bin/bash
set -euo pipefail

# Package an already built and signed Apple Silicon application.
root=$(cd "$(dirname "$0")/.." && pwd)
app=${1:-"$root/src-tauri/target/release/bundle/macos/TypePro.app"}
output=${2:-"$root/TypePro-1.1.0-mac-arm64.dmg"}
if [[ ! -d "$app/Contents" ]]; then
  echo "Application bundle not found: $app" >&2
  exit 1
fi
codesign --verify --deep --strict "$app"
stage=$(mktemp -d "${TMPDIR:-/tmp}/notebook-dmg.XXXXXX")
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/TypePro.app"
ln -s /Applications "$stage/Applications"
mkdir -p "$(dirname "$output")"
hdiutil create -volname "TypePro" -srcfolder "$stage" -ov -format UDZO "$output"
hdiutil verify "$output"
