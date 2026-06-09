#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

UUID=$(python3 -c 'import json; print(json.load(open("metadata.json"))["uuid"])')
OUT_DIR="$ROOT_DIR/dist"
WORK="$ROOT_DIR/.package-build"
mkdir -p "$OUT_DIR"
rm -rf "$WORK"
mkdir -p "$WORK"

cp extension-esm.js "$WORK/extension.js"
cp prefs-esm.js "$WORK/prefs.js"
cp metadata.json stylesheet.css "$WORK/"
cp -r schemas "$WORK/"

ZIP="${OUT_DIR}/${UUID}.shell-extension.zip"
rm -f "$ZIP"

echo "Compiling schemas…"
glib-compile-schemas "$WORK/schemas"
rm -f "$WORK/schemas/gschemas.compiled"

echo "Packing -> $ZIP"
(cd "$WORK" && zip -r "$ZIP" \
  extension.js prefs.js metadata.json stylesheet.css schemas \
  >/dev/null)

rm -rf "$WORK"
echo "Done: $ZIP"
