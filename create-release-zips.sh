#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

UUID=$(python3 -c 'import json;print(json.load(open("metadata.json"))["uuid"])')
NAME_45_50="${UUID}-45-50.shell-extension.zip"

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

copy_core "$WORK/45-50"
cp extension-esm.js "$WORK/45-50/extension.js"
cp prefs-esm.js "$WORK/45-50/prefs.js"
patch_metadata_shell_versions "$WORK/45-50/metadata.json" 45 46 47 48 49 50
python3 - "$WORK/45-50/metadata.json" metadata.json << 'PY'
import json, sys
path, src = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8') as f:
    root = json.load(f)
with open(path, 'r+', encoding='utf-8') as f:
    m = json.load(f)
    m['version'] = root['version']
    m['version-name'] = root['version-name']
    f.seek(0)
    json.dump(m, f, indent=2)
    f.write('\n')
    f.truncate()
PY
(cd "$WORK/45-50" && zip -r "../$NAME_45_50" extension.js prefs.js metadata.json stylesheet.css schemas README.md LICENSE CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md >/dev/null)

mv "$WORK/$NAME_45_50" "$DIST/"

echo "Created: $DIST/$NAME_45_50"
