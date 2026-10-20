#!/usr/bin/env python3
"""Screenshot every EaseHub Settings tab on the live X11 desktop.

Opens the prefs window (one tab at a time via the 'prefs-page' key), places it
at a fixed size and scrolls with the pointer parked in the window's empty left
margin, so nothing is clicked and no setting can change. Keep your hands off
the mouse for the ~40 s it runs.
"""
import re
import subprocess
import sys
import time
from pathlib import Path

UUID = 'comfort-control@nickotmazgin'
TITLE = 'Comfort Control (EaseHub)'
TITLE_RE = '^' + re.escape(TITLE) + '$'
SCHEMADIR = Path.home() / '.local/share/gnome-shell/extensions' / UUID / 'schemas'
W, H = 880, 1040
PAGES = ['general', 'menu', 'files', 'about']


def sh(*a, check=True):
    return subprocess.run(a, check=check, capture_output=True, text=True).stdout.strip()


def gset(key, value=None):
    base = ['gsettings', '--schemadir', str(SCHEMADIR)]
    if value is None:
        return sh(*base, 'get', 'org.gnome.shell.extensions.easehub', key)
    sh(*base, 'set', 'org.gnome.shell.extensions.easehub', key, value)


def window():
    for _ in range(60):
        ids = sh('xdotool', 'search', '--onlyvisible', '--name', TITLE_RE, check=False).split()
        if ids:
            return ids[-1]
        time.sleep(0.25)
    raise RuntimeError('prefs window did not appear')


def close_existing():
    for wid in sh('xdotool', 'search', '--name', TITLE_RE, check=False).split():
        subprocess.run(['xdotool', 'windowclose', wid], check=False)
    time.sleep(0.8)


def geometry(wid):
    out = dict(line.split('=') for line in sh('xdotool', 'getwindowgeometry', '--shell', wid).splitlines())
    return int(out['X']), int(out['Y']), int(out['WIDTH']), int(out['HEIGHT'])


def grab(wid, path):
    """Capture the window and crop away the transparent client-side shadow."""
    sh('import', '-window', wid, str(path))
    from PIL import Image
    img = Image.open(path).convert('RGB')
    box = img.convert('L').point(lambda v: 255 if v > 12 else 0).getbbox()
    if box:
        img.crop(box).save(path)


def content_hash(path):
    """Hash ignoring the right edge, where the overlay scrollbar fades in and out."""
    from PIL import Image
    img = Image.open(path)
    return hash(img.crop((0, 0, img.width - 70, img.height)).tobytes())


def main(out: Path, start: int):
    out.mkdir(parents=True, exist_ok=True)
    saved_page = gset('prefs-page')
    n = start
    try:
        for page in PAGES:
            close_existing()
            gset('prefs-page', page)
            subprocess.Popen(['gnome-extensions', 'prefs', UUID])
            wid = window()
            time.sleep(1.2)
            sh('xdotool', 'windowsize', wid, str(W), str(H))
            sh('xdotool', 'windowmove', wid, str((1920 - W) // 2), '20')
            time.sleep(1.0)
            x, y, w, h = geometry(wid)
            prev = None
            for part in range(1, 9):
                path = out / f'{n}-settings-{page}-{part}.png'
                grab(wid, path)
                data = content_hash(path)
                if data == prev:
                    path.unlink()
                    break
                prev = data
                print('saved', path.name, flush=True)
                n += 1
                # Empty left margin beside the content column (inside the frame, past the shadow).
                sh('xdotool', 'mousemove', str(x + 95), str(y + h // 2))
                sh('xdotool', 'click', '--repeat', '9', '--delay', '40', '5')
                time.sleep(0.8)
            close_existing()
    finally:
        gset('prefs-page', saved_page)
        close_existing()


if __name__ == '__main__':
    main(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 10)
