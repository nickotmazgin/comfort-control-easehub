#!/usr/bin/env bash
# Local convenience wrapper: build the release zip and optionally install it.
#   ./package.sh            build dist/<uuid>-<range>.shell-extension.zip
#   ./package.sh --install  build, then install it for the current user
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

./create-release-zips.sh
ZIP=$(ls -t dist/*.shell-extension.zip | head -1)

if [[ "${1:-}" == "--install" ]]; then
  gnome-extensions install --force "$ZIP"
  echo "Installed $ZIP"
  echo "Restart GNOME Shell to load the new code (Wayland: log out/in; X11: Alt+F2, r)."
fi
