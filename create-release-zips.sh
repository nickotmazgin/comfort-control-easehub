#!/usr/bin/env bash
# Build the release zip: dist/<uuid>-<first>-<last>.shell-extension.zip
# The GNOME range in the file name comes from metadata.json "shell-version".
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

UUID=$(python3 -c 'import json;print(json.load(open("metadata.json"))["uuid"])')
RANGE=$(python3 -c 'import json;v=json.load(open("metadata.json"))["shell-version"];print(f"{v[0]}-{v[-1]}")')
NAME="${UUID}-${RANGE}.shell-extension.zip"

WORK=.release-build
DIST=dist
STAGE="$WORK/$RANGE"
rm -rf "$WORK" && mkdir -p "$STAGE" "$DIST"

cp extension-esm.js "$STAGE/extension.js"
cp prefs-esm.js "$STAGE/prefs.js"
cp metadata.json stylesheet.css README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md "$STAGE/"
cp -r schemas scripts icons lib "$STAGE/"
rm -f "$STAGE/schemas/gschemas.compiled"
chmod +x "$STAGE"/scripts/*.sh

# Fail the build on a broken schema; the compiled file is not shipped
# (GNOME 44+ compiles schemas on install).
glib-compile-schemas --strict --dry-run "$STAGE/schemas"

rm -f "$DIST/$NAME"
(cd "$STAGE" && zip -qr "$ROOT_DIR/$DIST/$NAME" \
  extension.js prefs.js metadata.json stylesheet.css schemas scripts icons lib \
  README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md)

echo "Created: $DIST/$NAME"
