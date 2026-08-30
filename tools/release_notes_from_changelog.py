#!/usr/bin/env python3
"""Extract GitHub release notes from CHANGELOG.md for EaseHub."""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_ROOT / "CHANGELOG.md"

FOOTER = """
## Compatibility

- **GNOME Shell 45–50** — Wayland and X11/Xorg session types supported
- **Maintainer runtime-tested (when noted in changelog):** X11/Xorg only unless a release explicitly states otherwise
- **X11-only:** Reload GNOME Shell menu item (hidden on Wayland)

## Install

Download **`comfort-control@nickotmazgin-45-50.shell-extension.zip`** from this release (GNOME Shell **45–50**), then:

```bash
gnome-extensions install --force comfort-control@nickotmazgin-45-50.shell-extension.zip
gnome-extensions enable comfort-control@nickotmazgin
```

Restart GNOME Shell after install:

- **Wayland:** log out and back in
- **X11 / Xorg:** `Alt+F2` → `r` → Enter

## GNOME 42–44 — discontinued

EaseHub **no longer supports GNOME Shell 42–44**. Use GNOME **45** or newer.
""".strip()


def section_for_version(text: str, version: str) -> str:
    v = version.lstrip("v")
    header = re.compile(rf"^## {re.escape(v)}\s+\(", re.MULTILINE)
    match = header.search(text)
    if not match:
        raise SystemExit(f"No CHANGELOG section for {v}")
    start = match.start()
    rest = text[start + 1 :]
    nxt = re.search(r"^## ", rest, re.MULTILINE)
    end = start + 1 + nxt.start() if nxt else len(text)
    block = text[start:end].strip()
    block = re.sub(rf"^## {re.escape(v)}\s+\([^\)]*\)\n+", "", block, count=1)
    return block.strip()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <version e.g. 1.0.5>")
    version = sys.argv[1].lstrip("v")
    text = CHANGELOG.read_text(encoding="utf-8")
    body = section_for_version(text, version)
    print("## Highlights\n")
    print(body)
    print()
    print(FOOTER)


if __name__ == "__main__":
    main()
