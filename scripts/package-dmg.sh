#!/bin/bash
set -euo pipefail

# Package an already built and signed Apple Silicon application.
root=$(cd "$(dirname "$0")/.." && pwd)
app=${1:-"$root/src-tauri/target/release/bundle/macos/笔记.app"}
output=${2:-"$root/笔记-1.0.0-mac-arm64.dmg"}
if [[ ! -d "$app/Contents" ]]; then
  echo "Application bundle not found: $app" >&2
  exit 1
fi
codesign --verify --deep --strict "$app"
stage=$(mktemp -d "${TMPDIR:-/tmp}/notebook-dmg.XXXXXX")
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/笔记.app"
ln -s /Applications "$stage/Applications"
mkdir -p "$(dirname "$output")"
hdiutil create -volname "笔记" -srcfolder "$stage" -ov -format UDZO "$output"
hdiutil verify "$output"
