#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

UUID=$(python3 -c 'import json;print(json.load(open("metadata.json"))["uuid"])')
NAME_42_44="${UUID}-42-44.shell-extension.zip"
NAME_45_47="${UUID}-45-47.shell-extension.zip"

WORK=.release-build
DIST=dist
rm -rf "$WORK" && mkdir -p "$WORK" "$DIST"

copy_core() {
  local target="$1"
  mkdir -p "$target"
  rsync -a --exclude ".git" --exclude ".release-build" --exclude "dist" ./ "$target/"
  (cd "$target/schemas" && glib-compile-schemas .)
}

patch_metadata_shell_versions() {
  local file="$1"; shift
  python3 - "$file" "$@" << 'PY'
import json,sys
path=sys.argv[1]
vers=sys.argv[2:]
with open(path,'r+',encoding='utf-8') as f:
    m=json.load(f)
    m['shell-version']=vers
    f.seek(0)
    json.dump(m,f,indent=2)
    f.write('\n')
    f.truncate()
PY
}

# Build 42-44
copy_core "$WORK/42-44"
patch_metadata_shell_versions "$WORK/42-44/metadata.json" 42 43 44
(cd "$WORK/42-44" && zip -r "../$NAME_42_44" extension.js prefs.js metadata.json stylesheet.css schemas screenshots README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md >/dev/null)

# Build 45-47
copy_core "$WORK/45-47"
patch_metadata_shell_versions "$WORK/45-47/metadata.json" 45 46 47
(cd "$WORK/45-47" && zip -r "../$NAME_45_47" extension.js prefs.js metadata.json stylesheet.css schemas screenshots README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md >/dev/null)

mv "$WORK/$NAME_42_44" "$DIST/"
mv "$WORK/$NAME_45_47" "$DIST/"

echo "Created: $DIST/$NAME_42_44"
echo "Created: $DIST/$NAME_45_47"
