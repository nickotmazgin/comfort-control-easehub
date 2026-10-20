#!/usr/bin/env python3
"""Capture EaseHub gallery screenshots and an HD demo video (GNOME on X11).

Subcommands:
  screenshots   PNGs into screenshots/v<version>/, plus screenshots/collage.jpg
  video         1080p H.264 demo with captions, narration and music in dist/media/
  all           Both, in one session
  remix         Re-mix voice and music of the last video (no recording)
  restore       Put your settings back by hand if a run was killed

Safety while capturing:
  * The menu must have the exact expected size before anything inside it is
    clicked. Only group headers, the Screenshot item, the Dark Mode tile, the
    settings button and Upgrade Packages (after checking its icon) are clicked;
    power buttons never are. Confirmations stay on and are only ever cancelled.
  * Your EaseHub settings, Dark Mode, Do Not Disturb, Night Light, enabled
    extensions, open windows and workspace are backed up and restored, also on
    Ctrl+C or an error.
  * App windows are minimised, desktop icons and notification banners are off,
    and the panel is blurred except around the EaseHub icon.

Requirements: X11 session, xdotool, wmctrl, xprop, xwininfo, ffmpeg (video),
python3-pil, python3-numpy, ImageMagick (convert). Hands off the mouse and
keyboard while it runs.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageGrab

REPO = Path(__file__).resolve().parents[2]
MEDIA_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(MEDIA_DIR))

UUID = 'comfort-control@nickotmazgin'
DCONF_PATH = '/org/gnome/shell/extensions/easehub/'
PREFS_TITLE = 'Comfort Control (EaseHub)'
BACKUP_ROOT = Path.home() / '.cache' / 'easehub-media'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
TOOLS_DIR = Path(os.environ.get('EASEHUB_MEDIA_TOOLS', Path.home() / '.cache' / 'clipflow-pro-media-tools'))

# Panel menu items, top to bottom, with every action enabled on X11.
ITEMS = ['lock', 'logout', 'reboot', 'poweroff', 'suspend',
         'dnd', 'darkmode', 'night-light',
         'settings', 'extensions', 'tweaks', 'open-terminal', 'shell-reload', 'sudo-extend',
         'clipboard-clear', 'clipboard-clear-primary', 'screenshot',
         'apt-update', 'apt-upgrade', 'flatpak-update', 'about-readme', 'donate',
         'prefs']
NEVER_CLICK = {'lock', 'logout', 'reboot', 'poweroff', 'suspend', 'shell-reload'}

GLOBAL_KEYS = [
    ('org.gnome.desktop.notifications', 'show-banners'),
    ('org.gnome.desktop.interface', 'color-scheme'),
    ('org.gnome.settings-daemon.plugins.color', 'night-light-enabled'),
    ('org.gnome.shell', 'enabled-extensions'),
]


# ---------------------------------------------------------------- helpers

def run(*args, check=True, capture=False, inp=None):
    res = subprocess.run(args, check=check, text=True, input=inp,
                         stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                         stderr=subprocess.PIPE if capture else subprocess.DEVNULL)
    return res.stdout.strip() if capture else res.returncode


def out(*args):
    return run(*args, check=False, capture=True)


def log(msg):
    print(f'[media] {msg}', flush=True)


def version():
    meta = json.loads((REPO / 'metadata.json').read_text(encoding='utf-8'))
    return (meta.get('version-name') or '').split()[0]


def shell_range():
    v = json.loads((REPO / 'metadata.json').read_text(encoding='utf-8'))['shell-version']
    return f'{v[0]}–{v[-1]}'


DEMO_CLASSES = ('org.gnome.Shell.Extensions', 'gjs.Gjs', 'gnome-shell')


def user_windows():
    """Visible app windows that are not part of the demo: [window id]."""
    found = []
    for line in out('wmctrl', '-lx').splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4 or parts[1] == '-1':
            continue
        title = parts[4] if len(parts) > 4 else ''
        if parts[2] in DEMO_CLASSES or title in (PREFS_TITLE, 'EaseHub Demo'):
            continue
        if '_NET_WM_STATE_HIDDEN' in out('xprop', '-id', parts[0], '_NET_WM_STATE'):
            continue
        found.append(parts[0])
    return found


def ensure_private():
    """Re-minimise any app that raised itself, so keys never land in it."""
    for wid in user_windows():
        log('hiding an app window again before continuing')
        run('xdotool', 'windowminimize', '--sync', wid, check=False)


def key(combo):
    ensure_private()
    run('xdotool', 'key', '--clearmodifiers', combo, check=False)


def move(x, y):
    run('xdotool', 'mousemove', str(int(x)), str(int(y)), check=False)


def click(x, y, button=1):
    ensure_private()
    move(x, y)
    time.sleep(0.6)  # let the shell register the hover before the press
    run('xdotool', 'click', str(button), check=False)


def grab():
    return ImageGrab.grab().convert('RGB')


def grab_settled(box=None, timeout=3.0):
    """Grab once the region stops changing (menus fade in and out)."""
    prev = grab()
    end = time.time() + timeout
    while time.time() < end:
        time.sleep(0.25)
        cur = grab()
        a, b = (prev.crop(box), cur.crop(box)) if box else (prev, cur)
        if ImageChops.difference(a, b).getbbox() is None:
            return cur
        prev = cur
    return prev


def work_area():
    for line in out('wmctrl', '-d').splitlines():
        if ' * ' in line:
            wa = line.split('WA:')[1].split()
            x, y = map(int, wa[0].split(','))
            w, h = map(int, wa[1].split('x'))
            return x, y, w, h
    return 0, 0, 1920, 1080


def _regex(text):
    """Escape a window title for xdotool's POSIX regex (titles contain parentheses)."""
    return ''.join(f'\\{c}' if c in '.^$*+?()[]{}|\\' else c for c in text)


def find_window(title, timeout=12.0):
    end = time.time() + timeout
    while time.time() < end:
        ids = out('xdotool', 'search', '--onlyvisible', '--name', f'^{_regex(title)}$').split()
        if ids:
            return ids[-1]
        time.sleep(0.2)
    raise RuntimeError(f'window not found: {title!r}')


def window_closed(wid, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if run('xdotool', 'getwindowname', wid, check=False) != 0:
            return True
        time.sleep(0.2)
    return False


def frame_extents(wid):
    raw = out('xprop', '-id', wid, '_GTK_FRAME_EXTENTS')
    if '=' not in raw:
        return 0, 0, 0, 0
    return tuple(int(v) for v in raw.split('=')[1].split(','))


def window_rect(wid):
    vals = {}
    for line in out('xwininfo', '-id', wid).splitlines():
        line = line.strip()
        for k in ('Absolute upper-left X', 'Absolute upper-left Y', 'Width', 'Height'):
            if line.startswith(k + ':'):
                vals[k] = int(line.split(':')[1])
    left, right, top, bottom = frame_extents(wid)
    return (vals['Absolute upper-left X'] + left, vals['Absolute upper-left Y'] + top,
            vals['Width'] - left - right, vals['Height'] - top - bottom)


def place_window(wid, width, height):
    """Centre a window with a content area of width x height (clamped to the work area)."""
    ax, ay, aw, ah = work_area()
    width, height = min(width, aw - 40), min(height, ah - 20)
    x, y = ax + (aw - width) // 2, ay + (ah - height) // 2
    run('wmctrl', '-i', '-r', wid, '-b', 'remove,maximized_vert,maximized_horz', check=False)
    left, right, top, bottom = frame_extents(wid)  # client-side shadow around the window
    run('xdotool', 'windowsize', wid, str(width + left + right), str(height + top + bottom), check=False)
    time.sleep(0.3)
    left, _right, top, _bottom = frame_extents(wid)
    run('xdotool', 'windowmove', wid, str(x - left), str(y - top), check=False)
    run('xdotool', 'windowactivate', '--sync', wid, check=False)
    time.sleep(0.8)


def rounded(img, radius=14):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    rgba = img.convert('RGBA')
    rgba.putalpha(mask)
    return rgba


def rel(path):
    return path.relative_to(REPO) if path.is_relative_to(REPO) else path


# ---------------------------------------------------------------- session

class Session:
    """Backs up your state, applies the demo state, and always restores."""

    def __init__(self):
        self.dir = BACKUP_ROOT / time.strftime('backup-%Y%m%d-%H%M%S')
        self.state = {}

    def backup(self):
        latest = BACKUP_ROOT / 'latest'
        if (latest / 'IN_PROGRESS').exists():
            log('previous run was interrupted; restoring its backup first')
            Session.restore_from(latest)
        self.dir.mkdir(parents=True, exist_ok=True)
        os.chmod(BACKUP_ROOT, 0o700)
        (self.dir / 'easehub.dconf').write_text(out('dconf', 'dump', DCONF_PATH) + '\n')
        self.state = {
            'gsettings': {f'{s} {k}': out('gsettings', 'get', s, k) for s, k in GLOBAL_KEYS},
            'desktop_icons': [e for e in out('gnome-extensions', 'list', '--enabled').splitlines()
                              if 'desktop-icons' in e or e.startswith('ding@')],
            'workspace': int(out('xdotool', 'get_desktop') or 0),
            'minimized': [],
        }
        self.save_state()
        (self.dir / 'IN_PROGRESS').touch()
        if latest.is_symlink() or latest.exists():
            latest.unlink()
        latest.symlink_to(self.dir.name)
        log(f'backed up your settings to {self.dir}')

    def save_state(self):
        (self.dir / 'state.json').write_text(json.dumps(self.state))

    @staticmethod
    def restore_from(bdir):
        bdir = Path(bdir).resolve()
        state = json.loads((bdir / 'state.json').read_text())
        run('dconf', 'reset', '-f', DCONF_PATH, check=False)
        run('dconf', 'load', DCONF_PATH, inp=(bdir / 'easehub.dconf').read_text(), check=False)
        for ext in state['desktop_icons']:
            run('gnome-extensions', 'enable', ext, check=False)
        # Restore exact values last, so enabled-extensions ends up byte-for-byte as it was.
        for sk, value in state['gsettings'].items():
            schema, k = sk.split(' ', 1)
            if value:
                run('gsettings', 'set', schema, k, value, check=False)
        run('wmctrl', '-s', str(state['workspace']), check=False)
        for wid in state.get('minimized', []):
            run('xdotool', 'windowactivate', '--sync', str(int(wid, 16)), check=False)
        (bdir / 'IN_PROGRESS').unlink(missing_ok=True)
        log('restored your EaseHub settings, theme, notifications, extensions, windows and workspace')

    def enter_demo(self):
        # Drop any cached sudo login: a stray click on a Sudo Timeout item can then
        # only show a password prompt, never change anything.
        run('sudo', '-K', check=False)
        run('gsettings', 'set', 'org.gnome.desktop.notifications', 'show-banners', 'false')
        run('gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', "'prefer-dark'")
        run('gsettings', 'set', 'org.gnome.settings-daemon.plugins.color', 'night-light-enabled', 'false')
        for ext in self.state['desktop_icons']:
            run('gnome-extensions', 'disable', ext, check=False)
        # Default EaseHub settings: every action shown, confirmations on, and the
        # Files right-click actions shown as on (the launchers must already exist).
        run('dconf', 'reset', '-f', DCONF_PATH, check=False)
        run('dconf', 'write', f'{DCONF_PATH}files-actions-enabled', 'true', check=False)
        time.sleep(1.0)
        hidden = user_windows()
        self.state['minimized'] += [w for w in hidden if w not in self.state['minimized']]
        self.save_state()
        for wid in hidden:
            run('xdotool', 'windowminimize', '--sync', wid, check=False)
        n = int(out('xprop', '-root', '_NET_NUMBER_OF_DESKTOPS').split('=')[1])
        run('wmctrl', '-s', str(n - 1), check=False)
        move(700, 400)
        time.sleep(1.5)

    @staticmethod
    def close_demo_windows():
        for wid in out('xdotool', 'search', '--name', f'^{_regex(PREFS_TITLE)}$').split():
            run('wmctrl', '-i', '-c', wid, check=False)


# ---------------------------------------------------------------- menu

def _icon_template():
    """Alpha mask of the EaseHub panel icon (the bundled hub icon), or None."""
    svg = REPO / 'icons' / 'easehub-symbolic.svg'
    if not svg.exists() or not shutil.which('convert'):
        return None
    png = Path(tempfile.mkdtemp(prefix='easehub-icon-')) / 'icon.png'
    if run('convert', '-background', 'none', '-density', '1200', str(svg), '-resize', '64x64', str(png), check=False):
        return None
    import numpy as np
    return np.asarray(Image.open(png).convert('RGBA'))[:, :, 3].astype(float)


def locate_icon(shot, band, template):
    """Template-match the panel icon anywhere in the panel band. Returns (x, y) or None."""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view
    gray = np.asarray(shot.convert('L').crop((0, band[0], shot.width, band[1]))).astype(float)
    best = (0.0, None)
    for size in range(14, 23):
        t = np.asarray(Image.fromarray(template.astype('uint8')).resize((size, size), Image.LANCZOS)).astype(float)
        t = (t - t.mean()) / (t.std() + 1e-6)
        win = sliding_window_view(gray, (size, size))
        mean = win.mean(axis=(2, 3), keepdims=True)
        std = win.std(axis=(2, 3), keepdims=True) + 1e-6
        ncc = (((win - mean) / std) * t).mean(axis=(2, 3))
        y, x = np.unravel_index(ncc.argmax(), ncc.shape)
        if ncc[y, x] > best[0]:
            best = (float(ncc[y, x]), (x + size // 2, band[0] + y + size // 2))
    log(f'icon match score {best[0]:.2f} at {best[1]}')
    # A weak match could be another panel icon; never click on a guess.
    return best[1] if best[0] >= 0.8 else None


# Compact menu geometry (default settings, X11, every item shown), measured
# from the menu's top-left corner. The run stops if the menu has another size.
MENU_SIZE = (326, 487)
ROW = 29
POWER_Y, POWER_X = 31, [46, 104, 163, 222, 281]          # lock, log out, suspend, restart, power off
VOLUME_Y, VOLUME_X = 70, {'mute': 36, 'down': 68, 'slider': 175, 'up': 292}
TILES = {'wifi': (65, 120), 'bluetooth': (163, 120), 'airplane': (261, 120),
         'dnd': (65, 182), 'darkmode': (163, 182), 'night-light': (261, 182), 'keep-awake': (65, 244)}
GROUPS = {'apps': 316, 'clip': 345, 'sys': 374, 'sudo': 403}  # header rows
GROUP_ITEMS = {'apps': 9, 'clip': 3, 'sys': 4, 'sudo': 8}
FOOTER_FROM_BOTTOM = 26


class Menu:
    def __init__(self):
        ax, ay, aw, ah = work_area()
        sh = grab().height
        self.band = (ay + ah, sh) if ay == 0 and ay + ah < sh else (0, ay)
        self.icon = None
        self.box = None       # current menu bbox
        self.desktop = None   # screen just before the menu opened
        self.clean = None     # screen with no menu, for close checks
        self._template = None

    def find_icon(self):
        """Locate the icon now (the tray shifts as windows are hidden or DND changes)."""
        override = os.environ.get('EASEHUB_ICON_X')
        if override:
            self.icon = (int(override), (self.band[0] + self.band[1]) // 2)
            return
        if self._template is None:
            self._template = _icon_template()
            if self._template is None:
                sys.exit('Could not load the panel icon; set EASEHUB_ICON_X to its x position.')
        self.icon = locate_icon(grab_settled((0, self.band[0], 1, self.band[1])), self.band, self._template)
        if not self.icon:
            sys.exit('Could not find the EaseHub icon in the panel; set EASEHUB_ICON_X to its x position.')

    def _menu_bbox(self, shot):
        diff = ImageChops.difference(self.clean, shot).convert('L').point(lambda v: 255 if v > 24 else 0)
        ImageDraw.Draw(diff).rectangle([0, self.band[0], diff.width, self.band[1]], fill=0)
        return diff.getbbox()

    def visible(self):
        if self.box is None:
            return False
        return ImageChops.difference(grab().crop(self.box), self.clean.crop(self.box)).convert('L').point(
            lambda v: 255 if v > 24 else 0).getbbox() is not None

    def close(self):
        """Close the menu and confirm it is gone (Escape, then the icon as a toggle)."""
        for attempt in range(4):
            if not self.visible():
                self.box = None
                return
            if attempt == 0:
                key('Escape')
            else:
                click(*self.icon)
            time.sleep(0.8)
        sys.exit('Could not close the EaseHub menu.')

    def open(self):
        """Open the menu from the panel icon; stops unless it has the expected size."""
        self.close()
        if self.clean is None:
            move(700, 300)
            time.sleep(0.6)
            self.clean = grab_settled()
        # After Escape closes a panel menu, GNOME can ignore the next click on its
        # icon, so a miss is simply clicked again.
        for attempt in range(6):
            move(700, 300)
            time.sleep(0.5)
            self.find_icon()
            self.desktop = grab_settled()
            click(*self.icon)
            time.sleep(1.0)
            box = self._menu_bbox(grab_settled())
            if box and box[0] - 40 <= self.icon[0] <= box[2] + 40:
                size = (box[2] - box[0], box[3] - box[1])
                if abs(size[0] - MENU_SIZE[0]) > 6 or abs(size[1] - MENU_SIZE[1]) > 6:
                    self.box = box
                    self.close()
                    sys.exit(f'Menu is {size}, expected {MENU_SIZE}; stopping before any click '
                             '(reset EaseHub settings or update the geometry).')
                self.box = box
                return box
            log(f'menu did not open (attempt {attempt + 1})')
        sys.exit('The EaseHub menu did not open; nothing was clicked inside it.')

    def at(self, rx, ry):
        """Screen point from menu-relative coordinates (top-left of the current menu)."""
        return self.box[0] + rx, self.box[1] + ry

    def hover(self, rx, ry, pause=0.6):
        move(*self.at(rx, ry))
        time.sleep(pause)

    def expand(self, group):
        """Open one group by clicking its header.

        The header is clicked again only if the menu did not change at all. Once
        anything changed, rows have moved, so a second click could land on an
        item; then the run waits for the animation instead of clicking.
        """
        n = GROUP_ITEMS[group]
        collapsed = self.box
        for _attempt in range(2):
            click(*self.at(80, GROUPS[group]))
            box = None
            for _ in range(8):                     # up to ~4 s for the expand animation
                time.sleep(0.5)
                box = self._menu_bbox(grab_settled(timeout=1.0))
                if box and box[1] <= collapsed[1] - n * ROW + 8:
                    self.box = box
                    log(f'expanded {group}: menu now {box}')
                    return box
            if box and abs(box[1] - collapsed[1]) > 6:
                break                               # it changed: never click again
        self.box = box
        self.close()
        sys.exit(f'Could not expand the {group} group; stopped without clicking anything else.')

    def item(self, group, k):
        """Menu-relative point of item k (0-based) inside an expanded group."""
        return 80, GROUPS[group] + ROW * (k + 1)

    def footer(self, name):
        return FOOTER_X[name], (self.box[3] - self.box[1]) - FOOTER_FROM_BOTTOM

    def row_has_orange_icon(self, rx, ry):
        """The Upgrade Packages row has an orange icon; check before clicking it."""
        x, y = self.at(24, ry)
        region = grab().crop((x - 8, y - 8, x + 8, y + 8))
        return any(r > 200 and 100 < g < 200 and b < 100 for r, g, b in region.getdata())

    def dialog_open(self):
        """True when the modal confirm dialog dims the screen."""
        ax, ay, _aw, _ah = work_area()
        probe = (ax + 20, ay + 20, ax + 120, ay + 120)
        return ImageChops.difference(grab().crop(probe), self.clean.crop(probe)).getbbox() is not None

    def shot(self, path, pad=12):
        """Save the menu plus the panel below it, blurred except around the icon."""
        img = grab()
        box = self.box
        x0, y0 = max(0, box[0] - pad), max(0, box[1] - pad)
        x1 = min(img.width, box[2] + pad)
        y1 = self.band[1] if self.band[0] > 0 else min(img.height, box[3] + pad)
        panel = img.crop((0, self.band[0], img.width, self.band[1]))
        blurred = panel.filter(ImageFilter.GaussianBlur(14))
        keep = (self.icon[0] - 70, 0, self.icon[0] + 70, panel.height)
        blurred.paste(panel.crop(keep), keep[:2])
        img.paste(blurred, (0, self.band[0]))
        img.crop((x0, y0, x1, y1)).save(path)
        log(f'saved {rel(path)}')


# ---------------------------------------------------------------- prefs

PREFS_W, PREFS_H = 860, 1000
TABS = {'general': -185, 'menu': -63, 'files': 61, 'about': 184}


def open_prefs(page='general'):
    run('dconf', 'write', f'{DCONF_PATH}prefs-page', f"'{page}'", check=False)
    subprocess.Popen(['gnome-extensions', 'prefs', UUID], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wid = find_window(PREFS_TITLE, timeout=30)
    place_window(wid, PREFS_W, PREFS_H)
    move(*window_center(wid))
    return wid


def window_center(wid):
    x, y, w, h = window_rect(wid)
    return x + w // 2, y + h // 2


def prefs_tab(wid, tab):
    x, y, w, _h = window_rect(wid)
    click(x + w // 2 + TABS[tab], y + 23)
    time.sleep(0.8)
    move(*window_center(wid))
    time.sleep(0.3)


def scroll_pages(wid, step=8):
    """Yield after each scroll step until the page stops moving (first yield is the top)."""
    x, y, w, h = window_rect(wid)
    box = (x + w // 10, y + 80, x + w * 9 // 10, y + h - 20)
    move(x + w // 2, y + h // 2)
    yield
    prev = grab().crop(box)
    for _ in range(12):
        for _ in range(step):
            run('xdotool', 'click', '5', check=False)
            time.sleep(0.05)
        time.sleep(0.6)
        cur = grab().crop(box)
        if ImageChops.difference(cur, prev).getbbox() is None:
            return
        prev = cur
        yield


def scroll_to_bottom(wid, step_delay=0.25, max_steps=60):
    x, y, w, h = window_rect(wid)
    move(x + w // 2, y + h // 2)
    box = (x + w // 10, y + h // 4, x + w * 7 // 10, y + h * 3 // 4)
    prev = grab().crop(box)
    for _ in range(max_steps):
        ensure_private()
        run('xdotool', 'click', '5', check=False)
        time.sleep(step_delay)
        cur = grab().crop(box)
        if ImageChops.difference(cur, prev).getbbox() is None:
            break
        prev = cur


def save_window(wid, path):
    time.sleep(0.5)
    x, y, w, h = window_rect(wid)
    rounded(grab().crop((x, y, x + w, y + h))).save(path)
    log(f'saved {rel(path)}')


def close_window(wid):
    run('wmctrl', '-i', '-c', wid, check=False)
    window_closed(wid)
    time.sleep(0.5)


# ---------------------------------------------------------------- Files (Nautilus)

DEMO_DIR = Path.home() / 'EaseHub Demo'
DEMO_FILE = (407, 110)          # "Project Notes.md" icon, relative to the window content
SCRIPTS_ROW = (447, 188)        # "Scripts" in the right-click menu
SUBMENU_ROWS = [(460, 160), (460, 188), (460, 216)]  # first rows of a sliding submenu
FILES_GROUPS = ['Copy', 'Open', 'Tools']


def make_demo_folder():
    (DEMO_DIR / 'Reports').mkdir(parents=True, exist_ok=True)
    (DEMO_DIR / 'Project Notes.md').write_text('# Project notes\n')
    (DEMO_DIR / 'build.sh').write_text('#!/bin/sh\necho hi\n')
    (DEMO_DIR / 'data.csv').write_text('name,value\na,1\n')
    (DEMO_DIR / 'Reports' / 'Q3.txt').write_text('Quarterly report\n')


def remove_demo_folder():
    shutil.rmtree(DEMO_DIR, ignore_errors=True)


def open_files_window():
    subprocess.Popen(['nautilus', '--new-window', str(DEMO_DIR)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wid = find_window(DEMO_DIR.name, timeout=20)
    place_window(wid, 1000, 640)
    time.sleep(0.8)
    return wid


def files_menu(wid, group):
    """Right-click the demo file and walk Scripts ▸ EaseHub ▸ <group>."""
    x, y, _w, _h = window_rect(wid)
    click(x + DEMO_FILE[0], y + DEMO_FILE[1], button=3)
    time.sleep(1.0)
    click(x + SCRIPTS_ROW[0], y + SCRIPTS_ROW[1])
    time.sleep(0.8)
    click(x + SUBMENU_ROWS[0][0], y + SUBMENU_ROWS[0][1])   # EaseHub
    time.sleep(0.8)
    gx, gy = SUBMENU_ROWS[FILES_GROUPS.index(group)]
    click(x + gx, y + gy)
    time.sleep(0.9)
    move(x + gx, y + gy - 60)


def save_files_shot(wid, path):
    """The Files window without its sidebar (your bookmarks), plus the open menu."""
    x, y, w, h = window_rect(wid)
    img = grab().crop((x + 200, y, x + w, y + h))
    rounded(img).save(path)
    log(f'saved {rel(path)}')


# ---------------------------------------------------------------- screenshots

def take_screenshots(menu, outdir, collage=True):
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob('*.png'):
        old.unlink()

    menu.open()
    move(menu.box[0] - 120, menu.box[1] + 40)
    time.sleep(0.6)
    menu.shot(outdir / '01-panel-menu.png')
    for i, group in enumerate(['apps', 'clip', 'sys', 'sudo'], start=2):
        menu.open()
        menu.expand(group)
        menu.hover(80, GROUPS[group])  # header highlighted, not an item
        menu.shot(outdir / f'{i:02d}-menu-{group}.png')
    menu.close()

    make_demo_folder()
    wid = open_files_window()
    for i, group in enumerate(FILES_GROUPS, start=6):
        files_menu(wid, group)
        save_files_shot(wid, outdir / f'{i:02d}-files-right-click-{group.lower()}.png')
        key('Escape')
        time.sleep(0.4)
        key('Escape')
        time.sleep(0.4)
    close_window(wid)

    n = 9
    for page in ['general', 'menu', 'files', 'about']:
        wid = open_prefs(page)
        for part, _ in enumerate(scroll_pages(wid), start=1):
            save_window(wid, outdir / f'{n:02d}-settings-{page}-{part}.png')
            n += 1
        close_window(wid)

    if collage:
        build_collage(outdir)


COLLAGE_PICKS = ['01-panel-menu', '02-menu-apps', '05-menu-sudo', '06-files-right-click-copy',
                 '09-settings-general-1', '10-settings-menu-1', '13-settings-files-1']


def build_collage(outdir):
    picks = outdir.parent / '.collage-picks'
    shutil.rmtree(picks, ignore_errors=True)
    picks.mkdir()
    shots = sorted(outdir.glob('*.png'))
    chosen = [p for p in shots if any(p.stem.startswith(c.split('-')[0]) and p.stem == c for c in COLLAGE_PICKS)]
    if len(chosen) < 6:
        chosen = shots[:8]
    for i, p in enumerate(chosen, start=1):
        shutil.copy2(p, picks / f'{i:02d}.png')
    png = outdir.parent / '.collage-build.png'
    run(sys.executable, str(REPO / 'tools' / 'make_collage_2026.py'), 'easehub', str(picks), str(png),
        '--github-social', str(REPO / '.github' / 'social-preview.png'))
    target = REPO / 'screenshots' / 'collage.jpg'
    im = Image.open(png).convert('RGB')
    im.save(target, 'JPEG', quality=90, subsampling=0, optimize=True)
    png.unlink()
    shutil.rmtree(picks, ignore_errors=True)
    log(f'saved {rel(target)} ({im.width}x{im.height}) and .github/social-preview.png')


# ---------------------------------------------------------------- video

class Voice:
    """Narration clips from Kokoro, cached by voice, speed and text."""

    def __init__(self):
        from narration import NARRATION, SPEED, VOICE
        self.lines, self.voice, self.speed = NARRATION, VOICE, SPEED
        self.dir = TOOLS_DIR / 'tts-cache' / f'{VOICE}-{SPEED}'
        self.files, self.lengths = {}, {}

    @staticmethod
    def available():
        return (TOOLS_DIR / 'venv' / 'bin' / 'python').exists() and (TOOLS_DIR / 'kokoro-v1.0.onnx').exists()

    def prepare(self):
        import hashlib
        self.dir.mkdir(parents=True, exist_ok=True)
        todo = {}
        for k, text in self.lines.items():
            h = hashlib.sha1(text.encode()).hexdigest()[:12]
            self.files[k] = self.dir / f'{h}.wav'
            if not self.files[k].exists():
                todo[h] = text
        if todo:
            log(f'speaking {len(todo)} narration line(s) with Kokoro ({self.voice})')
            lines = self.dir / 'todo.json'
            lines.write_text(json.dumps(todo), encoding='utf-8')
            env = dict(os.environ, EASEHUB_MEDIA_TOOLS=str(TOOLS_DIR))
            subprocess.run([str(TOOLS_DIR / 'venv' / 'bin' / 'python'), str(MEDIA_DIR / 'tts_kokoro.py'),
                            str(lines), str(self.dir), self.voice, str(self.speed)],
                           check=True, env=env, stdout=subprocess.DEVNULL)
            lines.unlink()
        for k, path in self.files.items():
            self.lengths[k] = float(out('ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                        '-of', 'csv=p=0', str(path)))

    def length(self, k):
        return self.lengths.get(k, 0.0)


class Recorder:
    def __init__(self, raw_path, voice):
        self.raw = raw_path
        self.voice = voice
        self.proc = None
        self.t0 = None
        self.captions = []
        self.voice_events = []
        self.voice_end = 0.0

    def start(self):
        img = grab()
        self.proc = subprocess.Popen(
            ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1',
             '-framerate', '30', '-video_size', f'{img.width}x{img.height}', '-i', os.environ.get('DISPLAY', ':0'),
             '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', str(self.raw)],
            stdin=subprocess.PIPE)
        time.sleep(1.0)
        self.t0 = time.monotonic()

    def caption(self, text, seconds, say=None):
        """Show a caption and speak its line; never overlaps the previous line."""
        self.settle()
        start = time.monotonic() - self.t0
        length = self.voice.length(say) if self.voice and say else 0
        if length:
            self.voice_events.append((start, say))
            self.voice_end = start + length
        self.captions.append((start, start + max(seconds, length + 0.3), text))

    def settle(self, pad=0.35):
        if self.voice_end:
            wait = self.voice_end + pad - (time.monotonic() - self.t0)
            if wait > 0:
                time.sleep(wait)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.communicate(b'q', timeout=30)


def make_video(menu, out_mp4, voice):
    workdir = Path(tempfile.mkdtemp(prefix='easehub-video-'))
    menu.open()           # measure once before recording
    menu.close()
    rec = Recorder(workdir / 'raw.mp4', voice)
    rec.start()
    try:
        rec.caption(f'Comfort Control (EaseHub) {version()} — GNOME Shell {shell_range()}', 4, 'title')
        time.sleep(4)

        rec.caption('Power: lock, log out, suspend, restart, power off', 4, 'power')
        menu.open()
        for x in POWER_X:                       # hover only: shows the tooltips
            menu.hover(x, POWER_Y, 0.9)
        rec.settle()

        rec.caption('Sound: mute, volume down and up', 4, 'sound')
        for name in ('mute', 'down', 'slider', 'up'):
            menu.hover(VOLUME_X[name], VOLUME_Y, 0.9)
        rec.settle()

        rec.caption('Quick toggles — each shows its current state', 5, 'toggles')
        for name in ('wifi', 'bluetooth', 'airplane', 'dnd', 'darkmode', 'night-light', 'keep-awake'):
            menu.hover(*TILES[name], 0.75)
        rec.settle()

        rec.caption('Apps & Files: Files, Settings, Trash, Recent files, right-click actions', 5, 'apps')
        menu.expand('apps')
        for k in range(GROUP_ITEMS['apps']):
            menu.hover(*menu.item('apps', k), 0.45)
        rec.settle()

        rec.caption("Screenshot opens GNOME's own screenshot tool", 4, 'screenshot')
        menu.open()
        menu.expand('clip')
        menu.hover(*menu.item('clip', 0), 0.6)
        click(*menu.at(*menu.item('clip', 0)))
        menu.box = None
        time.sleep(3.0)
        rec.settle()
        key('Escape')
        time.sleep(1.0)

        rec.caption('Updates & System — risky actions always ask first', 5, 'confirm')
        menu.open()
        menu.expand('sys')
        for k in range(GROUP_ITEMS['sys']):
            menu.hover(*menu.item('sys', k), 0.5)
        upgrade = menu.item('sys', 1)
        menu.hover(*upgrade, 0.5)
        if menu.row_has_orange_icon(*upgrade):
            click(*menu.at(*upgrade))
            menu.box = None
            time.sleep(1.5)
            if not menu.dialog_open():
                log('warning: the confirm dialog was not detected')
            time.sleep(1.5)
            rec.settle()
            key('Escape')           # Cancel — never Proceed
            time.sleep(1.0)
        else:
            log('Upgrade row not where expected; skipped clicking it')
            menu.close()

        rec.caption('Sudo Timeout — visudo-checked, with Forget Password Now', 5, 'sudo')
        menu.open()
        menu.expand('sudo')
        for k in range(GROUP_ITEMS['sudo']):
            menu.hover(*menu.item('sudo', k), 0.45)
        rec.settle()
        menu.close()

        rec.caption('Files right-click menu: Scripts ▸ EaseHub ▸ Copy, Open, Tools', 6, 'files')
        make_demo_folder()
        fw = open_files_window()
        for group in FILES_GROUPS:
            files_menu(fw, group)
            time.sleep(1.6)
            key('Escape')
            time.sleep(0.3)
            key('Escape')
            time.sleep(0.4)
        rec.settle()
        close_window(fw)

        rec.caption('EaseHub Settings — always at the bottom of the menu', 3, 'settings')
        menu.open()
        menu.hover(*menu.footer('settings'), 0.9)
        click(*menu.at(*menu.footer('settings')))
        menu.box = None
        wid = find_window(PREFS_TITLE, timeout=30)
        place_window(wid, PREFS_W, PREFS_H)
        time.sleep(1.0)
        rec.settle()

        rec.caption('Dark Mode from the panel — apps follow instantly', 6, 'darkmode')
        for _ in range(2):
            menu.open()
            menu.hover(*TILES['darkmode'], 0.5)
            click(*menu.at(*TILES['darkmode']))
            time.sleep(2.2)
            menu.close()
        rec.settle()

        for page, line in [('general', 'general'), ('menu', 'menu'), ('files', 'files_tab'), ('about', 'about')]:
            rec.caption({'general': 'General — layout, icon, position, shortcut, appearance, terminal',
                         'menu': 'Menu — show only the items you want',
                         'files': 'Files — rename, hide or regroup the right-click actions',
                         'about': f'GNOME Shell {shell_range()} · Wayland & X11'}[page], 4, line)
            prefs_tab(wid, page)
            time.sleep(1.0)
            scroll_to_bottom(wid)
            time.sleep(0.8)
            rec.settle()
        close_window(wid)

        rec.caption('Free & open source · github.com/nickotmazgin/comfort-control-easehub', 5, 'end')
        time.sleep(4)
        rec.settle(pad=1.5)
    finally:
        rec.stop()

    render_video(rec.raw, out_mp4, rec.captions, menu, workdir)
    add_audio(out_mp4, rec, workdir)
    shutil.rmtree(workdir, ignore_errors=True)


def render_video(raw, out_mp4, captions, menu, workdir):
    img = grab()
    sw = img.width
    py0, py1 = menu.band
    ph = py1 - py0
    kx = max(0, min(sw - 160, menu.icon[0] - 80))
    chains = ['[0:v]split=3[base][p][k]',
              f'[p]crop={sw}:{ph}:0:{py0},boxblur=luma_radius=20:luma_power=4:chroma_radius=10:chroma_power=4[pb]',
              f'[base][pb]overlay=0:{py0}[t0]',
              f'[k]crop=160:{ph}:{kx}:{py0}[kc]',
              f'[t0][kc]overlay={kx}:{py0}[t1]']
    last = 't1'
    for i, (start, end, text) in enumerate(captions):
        tf = workdir / f'cap{i}.txt'
        tf.write_text(text, encoding='utf-8')
        nxt = f'c{i}'
        chains.append(
            f"[{last}]drawtext=fontfile={FONT}:textfile={tf}:fontsize=40:fontcolor=white:"
            f"box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=48:"
            f"enable='between(t,{start:.2f},{end:.2f})'[{nxt}]")
        last = nxt
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    run('ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-filter_complex', ';'.join(chains),
        '-map', f'[{last}]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-r', '30', str(out_mp4))
    log(f'saved {rel(out_mp4)}')


MUSIC_GAIN = 0.045


def add_audio(mp4, rec, workdir):
    silent = mp4.with_name(mp4.stem + '.video-only.mp4')
    shutil.copy2(mp4, silent)
    events = [(start, str(rec.voice.files[k])) for start, k in rec.voice_events] if rec.voice else []
    mp4.with_name(mp4.stem + '.voice.json').write_text(json.dumps(events))
    mix_audio(silent, events, mp4, workdir)


def mix_audio(silent, events, mp4, workdir):
    """Narration over the original music bed, ducked under speech, at -14 LUFS."""
    length = float(out('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(silent)))
    music = Path(workdir) / 'music.wav'
    run(sys.executable, str(MEDIA_DIR / 'make_music.py'), str(music), f'{length:.2f}', '5')
    inputs = ['-i', str(silent), '-i', str(music)]
    chains = [f'[1:a]volume={MUSIC_GAIN}[bed]']
    voices = []
    for i, (start, wav) in enumerate(events):
        inputs += ['-i', wav]
        ms = int(start * 1000)
        chains.append(f'[{i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]')
        voices.append(f'[v{i}]')
    if voices:
        chains.append(f"{''.join(voices)}amix=inputs={len(voices)}:normalize=0,asplit=2[vo][sc]")
        chains.append('[bed][sc]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=450[duck]')
        chains.append('[duck][vo]amix=inputs=2:normalize=0[mix]')
    else:
        chains.append('[bed]volume=3[mix]')
    chains.append('[mix]anull[a]')
    mixed = Path(workdir) / 'mix.wav'
    run('ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(chains),
        '-map', '[a]', '-t', f'{length:.2f}', str(mixed))
    target = 'I=-14:TP=-1.5:LRA=11'
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(mixed), '-af',
                            f'loudnorm={target}:print_format=json', '-f', 'null', '-'],
                           capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
    norm = (f"loudnorm={target}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
            f"offset={m['target_offset']}:linear=true,aresample=48000")
    tmp = mp4.with_name(mp4.stem + '.tmp.mp4')
    run('ffmpeg', '-y', '-loglevel', 'error', '-i', str(silent), '-i', str(mixed), '-af', norm,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-movflags', '+faststart', str(tmp))
    tmp.replace(mp4)
    log(f'mixed narration ({len(voices)} lines) and music into {mp4.name}')


def remix(mp4):
    silent = mp4.with_name(mp4.stem + '.video-only.mp4')
    events = json.loads(mp4.with_name(mp4.stem + '.voice.json').read_text())
    with tempfile.TemporaryDirectory() as work:
        mix_audio(silent, events, mp4, work)


# ---------------------------------------------------------------- main

def preflight():
    if os.environ.get('XDG_SESSION_TYPE') != 'x11':
        sys.exit('This tool needs an X11 session (xdotool/x11grab).')
    for tool in ('xdotool', 'wmctrl', 'xprop', 'xwininfo', 'dconf', 'gnome-extensions'):
        if not shutil.which(tool):
            sys.exit(f'Missing tool: {tool}')
    if 'ACTIVE' not in out('gnome-extensions', 'info', UUID):
        sys.exit('EaseHub is not active. Install it (./package.sh --install) and reload GNOME Shell first.')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['screenshots', 'video', 'all', 'restore', 'remix'])
    ap.add_argument('--out', type=Path, help='screenshot folder (default screenshots/v<version>)')
    ap.add_argument('--video-out', type=Path, help='video path (default dist/media/easehub-v<version>-demo.mp4)')
    ap.add_argument('--no-collage', action='store_true')
    ap.add_argument('--countdown', type=int, default=5)
    args = ap.parse_args()

    video_out = args.video_out or REPO / 'dist' / 'media' / f'easehub-v{version()}-demo.mp4'
    if args.command == 'restore':
        Session.restore_from(BACKUP_ROOT / 'latest')
        return
    if args.command == 'remix':
        remix(video_out)
        return

    sys.exit(
        'This command clicks the real panel menu and is disabled.\n'
        'Use: python3 tools/media/showcase.py shots|video|all\n'
        'Settings tabs: python3 tools/media/prefs_shots.py screenshots/v<version> 10'
    )


if __name__ == '__main__':
    main()
