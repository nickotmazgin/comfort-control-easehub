#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

UUID=$(python3 -c 'import json; print(json.load(open("metadata.json"))["uuid"])')
OUT_DIR="$ROOT_DIR/dist"
mkdir -p "$OUT_DIR"

ZIP="${OUT_DIR}/${UUID}.shell-extension.zip"
rm -f "$ZIP"

echo "Compiling schemas…"
glib-compile-schemas schemas

echo "Packing -> $ZIP"
zip -r "$ZIP" \
  extension.js prefs.js metadata.json stylesheet.css schemas screenshots README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md >/dev/null

echo "Done: $ZIP"

