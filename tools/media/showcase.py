#!/usr/bin/env python3
"""Screenshots, collage, social preview and a narrated HD demo — safely.

Everything runs inside an isolated nested GNOME Shell window (its own D-Bus
session, settings database and extension folder), driven by the test-only
extension in tools/media/showcase/. Your desktop, mouse and keyboard are not
used, and settings changed during the tour never reach your real session.

  python3 tools/media/showcase.py shots    # screenshots/v<version>/, collage, social preview
  python3 tools/media/showcase.py video    # dist/media/easehub-v<version>-demo.mp4
  python3 tools/media/showcase.py all

Your shell theme, icon theme, fonts and wallpaper are copied into the nested
session so it looks like your desktop. Needs GNOME Shell on X11 (to record the
nested window), ffmpeg for video, and Kokoro for narration (tools/media/README.md).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

MEDIA = Path(__file__).resolve().parent
REPO = MEDIA.parents[1]
sys.path.insert(0, str(MEDIA))

import easehub_media as em  # noqa: E402  (voice, audio mix, collage helpers)

UUID = 'comfort-control@nickotmazgin'
SIZE = (1600, 1000)
COPY_KEYS = [
    ('org.gnome.shell.extensions.user-theme', 'name'),
    ('org.gnome.desktop.interface', 'gtk-theme'),
    ('org.gnome.desktop.interface', 'icon-theme'),
    ('org.gnome.desktop.interface', 'cursor-theme'),
    ('org.gnome.desktop.interface', 'font-name'),
    ('org.gnome.desktop.background', 'picture-uri'),
    ('org.gnome.desktop.background', 'picture-uri-dark'),
]
DEMO_FILES = {
    'Project Notes.md': '# Project notes\n',
    'build.sh': '#!/bin/sh\necho hi\n',
    'data.csv': 'name,value\na,1\n',
    'Reports/Q3.txt': 'Quarterly report\n',
}


def log(msg):
    print(f'[showcase] {msg}', flush=True)


def real_settings():
    vals = []
    for schema, key in COPY_KEYS:
        v = subprocess.run(['gsettings', 'get', schema, key], capture_output=True, text=True).stdout.strip()
        if v:
            vals.append((schema, key, v))
    return vals


def prepare(work: Path, mode: str, durations: dict, parts: str = 'menu,files,prefs', scale: int = 1) -> dict:
    """Build the zip, lay out the private data dir and return the env for the run."""
    # Menu screenshots render at 2x (logical 1200x900) for crisp HiDPI images. Files
    # and the video stay at 1:1: the Nautilus click offsets are measured at 1x, and
    # the recorded window must fit on the real screen.
    # Video is grabbed from the host X screen (1920x1080 here). A 1600x1000 client
    # plus the window frame is taller than that screen, and x11grab refuses any
    # rectangle that crosses the root edge. 1600x860 stays fully on screen.
    client = (1600, 860) if mode == 'video' and scale == 1 else SIZE
    display = ('MUTTER_DEBUG_DUMMY_MODE_SPECS=2400x1800 MUTTER_DEBUG_DUMMY_MONITOR_SCALES=2' if scale == 2
               else f'MUTTER_DEBUG_DUMMY_MODE_SPECS={client[0]}x{client[1]}')
    subprocess.run([str(REPO / 'create-release-zips.sh')], check=True, stdout=subprocess.DEVNULL)
    zip_path = max((REPO / 'dist').glob('*.shell-extension.zip'), key=lambda p: p.stat().st_mtime)
    ext_dir = work / 'data' / 'gnome-shell' / 'extensions'
    (ext_dir / UUID).mkdir(parents=True)
    subprocess.run(['unzip', '-q', str(zip_path), '-d', str(ext_dir / UUID)], check=True)
    subprocess.run(['glib-compile-schemas', str(ext_dir / UUID / 'schemas')], check=True)
    show = ext_dir / 'easehub-showcase@local'
    show.mkdir()
    shutil.copy2(MEDIA / 'showcase' / 'extension.js', show / 'extension.js')
    shell_major = subprocess.run(['gnome-shell', '--version'], capture_output=True, text=True).stdout.split()[2].split('.')[0]
    (show / 'metadata.json').write_text(json.dumps({
        'uuid': 'easehub-showcase@local', 'name': 'EaseHub showcase driver',
        'description': 'test only', 'shell-version': [shell_major]}))
    (work / 'config').mkdir()
    out = work / 'out'
    out.mkdir()
    demo = Path.home() / 'EaseHub Demo'
    for rel, text in DEMO_FILES.items():
        (demo / rel).parent.mkdir(parents=True, exist_ok=True)
        (demo / rel).write_text(text)

    sets = '\n'.join(f'gsettings set {s} {k} {json.dumps(v)}' for s, k, v in real_settings())
    run_sh = work / 'run.sh'
    run_sh.write_text(f'''set -e
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['{UUID}','easehub-showcase@local','user-theme@gnome-shell-extensions.gcampax.github.com']"
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
gsettings set org.gnome.desktop.notifications show-banners false
{sets}
sleep 1
[ -s "$XDG_CONFIG_HOME/dconf/user" ] || {{ echo "ISOLATION FAILED"; exit 1; }}
# gsd-rfkill is absent on this private bus; without it the Bluetooth and Airplane tiles hide.
python3 {MEDIA / 'showcase' / 'mock_rfkill.py'} &
sleep 0.5
{display} timeout {600 if mode == 'video' else 150} gnome-shell --nested --wayland || true
''')
    env = dict(os.environ, XDG_DATA_HOME=str(work / 'data'), XDG_CONFIG_HOME=str(work / 'config'),
               EASEHUB_SHOWCASE_OUT=str(out), EASEHUB_SHOWCASE_MODE=mode, EASEHUB_SHOWCASE_PARTS=parts, EASEHUB_SHOWCASE_SCALE=str(scale),
               EASEHUB_SHOWCASE_DEMO_DIR=str(demo), EASEHUB_SHOWCASE_CLIENT=f'{client[0]}x{client[1]}',
               EASEHUB_SHOWCASE_DURATIONS=json.dumps(durations))
    return env


def _window_geom(wid: str) -> dict:
    info = subprocess.run(['xwininfo', '-id', wid], capture_output=True, text=True).stdout
    name = subprocess.run(['xdotool', 'getwindowname', wid], capture_output=True, text=True).stdout.strip()
    vals = {'name': name, 'id': wid}
    for line in info.splitlines():
        line = line.strip()
        for k in ('Absolute upper-left X', 'Absolute upper-left Y', 'Width', 'Height'):
            if line.startswith(k + ':'):
                vals[k] = int(line.split(':')[1])
    return vals


def _stage_rect(client, frame):
    """The nested Shell's own client window inside the host frame.

    The frame rectangle also covers its title bar and an invisible shadow margin,
    and x11grab records whatever is on the desktop behind that margin.
    """
    if not client:
        return None
    cw, ch = client
    fx, fy, fw, fh = frame
    tree = subprocess.run(['xwininfo', '-root', '-tree'], capture_output=True, text=True).stdout
    for line in tree.splitlines():
        m = re.search(r'\s(\d+)x(\d+)\+-?\d+\+-?\d+\s+\+(-?\d+)\+(-?\d+)\s*$', line)
        if not m:
            continue
        w, h, x, y = (int(g) for g in m.groups())
        if (w, h) == (cw, ch) and fx <= x and fy <= y and x + w <= fx + fw + 2 and y + h <= fy + fh + 2:
            return x, y, w - w % 2, h - h % 2
    return None


def nested_window(timeout=60, client=None):
    """Find the nested Shell window on the host display.

    Its size is often a few pixels off 1600x1000 once the frame is included, and
    the title is not always exactly gnome-shell. Return x, y, width, height.
    """
    end = time.time() + timeout
    seen = {}
    while time.time() < end:
        ids = set()
        for flag in ('--name', '--class'):
            ids.update(subprocess.run(['xdotool', 'search', '--onlyvisible', flag, 'gnome-shell'],
                                      capture_output=True, text=True).stdout.split())
            ids.update(subprocess.run(['xdotool', 'search', '--onlyvisible', flag, 'Mutter'],
                                      capture_output=True, text=True).stdout.split())
        best = None
        for wid in ids:
            vals = _window_geom(wid)
            seen[wid] = vals
            w, h = vals.get('Width'), vals.get('Height')
            if not w or not h or w < 900 or h < 600:
                continue
            name = (vals.get('name') or '').lower()
            if 'guard' in name:
                continue
            score = abs(w - SIZE[0]) + abs(h - SIZE[1])
            # Prefer the nested Shell client over the full-screen Mutter guard.
            if 'gnome-shell' in name:
                score -= 200
            if best is None or score < best[0]:
                best = (score, vals)
        # Frame decorations put the host window ~100px past the dummy mode.
        if best and best[0] <= 400:
            v = best[1]
            x, y = v['Absolute upper-left X'], v['Absolute upper-left Y']
            w, h = v['Width'], v['Height']
            sw, sh = (int(n) for n in subprocess.run(
                ['xdotool', 'getdisplaygeometry'], capture_output=True, text=True, check=True).stdout.split())
            # x11grab errors (BadDrawable) if the rectangle leaves the root window.
            x1, y1 = max(0, x), max(0, y)
            x2, y2 = min(sw, x + w), min(sh, y + h)
            w, h = x2 - x1, y2 - y1
            w -= w % 2
            h -= h % 2
            if w < 900 or h < 600:
                time.sleep(0.4)
                continue
            log(f"nested window {w}x{h} at {x1},{y1} '{v['name']}'")
            stage = _stage_rect(client, (x1, y1, w, h))
            if stage:
                log(f'recording only the nested stage {stage[2]}x{stage[3]} at {stage[0]},{stage[1]}')
                return stage
            return x1, y1, w, h
        time.sleep(0.4)
    summary = ', '.join(f"{v.get('Width')}x{v.get('Height')} {v.get('name')}" for v in seen.values()) or 'none'
    raise RuntimeError(f'nested window not found; saw: {summary}')


def run_session(work: Path, env: dict, record: Path | None):
    """Run the nested session; with `record`, capture its window to that file."""
    logf = work / 'log.txt'
    proc = subprocess.Popen(['dbus-run-session', '--', 'bash', str(work / 'run.sh')], env=env,
                            stdout=open(logf, 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    rec, rec_start = None, None
    try:
        if record:
            spec = env.get('EASEHUB_SHOWCASE_CLIENT', '')
            client = tuple(int(n) for n in spec.split('x')) if spec else None
            x, y, w, h = nested_window(client=client)
            rec = subprocess.Popen(
                ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30',
                 '-video_size', f'{w}x{h}', '-i', f"{os.environ.get('DISPLAY', ':0')}+{x},{y}",
                 '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', str(record)],
                stdin=subprocess.PIPE)
            rec_start = time.time() * 1e6
        while proc.poll() is None:
            text = logf.read_text(errors='replace')
            if 'EHSHOW DONE' in text or 'EHSHOW FAIL' in text or 'ISOLATION FAILED' in text:
                break
            time.sleep(0.5)
        time.sleep(1.0)
    finally:
        if rec and rec.poll() is None:
            rec.communicate(b'q', timeout=30)
        # Stop the nested shell and everything it started (its own process group).
        import signal
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=15)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        # A killed nested shell can leave GNOME's crash guard behind; never let it
        # disable extensions in your real session.
        guard = Path(f"/run/user/{os.getuid()}/gnome-shell-disable-extensions")
        if guard.exists() and guard.stat().st_mtime > time.time() - 600:
            guard.unlink()
    text = logf.read_text(errors='replace')
    for line in text.splitlines():
        if 'EHSHOW' in line and ('FAIL' in line or 'saved' in line or 'START' in line or 'DONE' in line):
            log(line.split('EHSHOW', 1)[1].strip())
    if 'EHSHOW DONE' not in text:
        raise RuntimeError(f'showcase did not finish; see {logf}')
    scenes = [json.loads(line.split('SCENE', 1)[1]) for line in text.splitlines() if 'EHSHOW SCENE' in line]
    return scenes, rec_start


@contextlib.contextmanager
def workdir():
    """Temporary work dir; kept when the run fails or EASEHUB_SHOWCASE_KEEP=1."""
    tmp = tempfile.mkdtemp(prefix='easehub-showcase-')
    try:
        yield tmp
    except BaseException:
        log(f'kept {tmp} for debugging')
        raise
    if os.environ.get('EASEHUB_SHOWCASE_KEEP') != '1':
        shutil.rmtree(tmp, ignore_errors=True)


def shots(args):
    """Menu (2x) and Files (1x) shots from the nested shell. The Settings tabs come
    from tools/media/prefs_shots.py on the live desktop and are left in place."""
    outdir = REPO / 'screenshots' / f'v{em.version()}'
    outdir.mkdir(parents=True, exist_ok=True)
    only = os.environ.get('EASEHUB_SHOWCASE_ONLY', '')
    passes = (('menu', 2), ('files', 1))
    if only == 'menu':
        passes = (('menu', 2),)
    elif only == 'files':
        passes = (('files', 1),)
    if not only:
        for old in outdir.glob('0*.png'):
            old.unlink()
    for parts, scale in passes:
        with workdir() as tmp:
            work = Path(tmp)
            env = prepare(work, 'shots', {}, parts, scale)
            try:
                run_session(work, env, None)
            finally:
                shutil.rmtree(Path.home() / 'EaseHub Demo', ignore_errors=True)
            for png in sorted((work / 'out').glob('*.png')):
                if png.name.startswith('dbg-'):
                    continue
                shutil.copy2(png, outdir / png.name)
    log(f'{len(list(outdir.glob("*.png")))} screenshots in {outdir.relative_to(REPO)}')
    if not list(outdir.glob('1*-settings-*.png')):
        log('no Settings shots yet: run tools/media/prefs_shots.py screenshots/v<version>')
    build_collage(outdir)


COLLAGE = ['02-panel-menu-tooltip', '03-menu-apps', '06-menu-sudo', '09-files-right-click-copy',
           '10-settings-general-1', '08-appearance-light']


def build_collage(outdir: Path):
    picks = Path(tempfile.mkdtemp(prefix='easehub-collage-'))
    chosen = [outdir / f'{name}.png' for name in COLLAGE if (outdir / f'{name}.png').exists()]
    for i, p in enumerate(chosen, start=1):
        shutil.copy2(p, picks / f'{i:02d}.png')
    png = picks / 'collage.png'
    subprocess.run([sys.executable, str(REPO / 'tools' / 'make_collage_2026.py'), 'easehub', str(picks), str(png),
                    '--github-social', str(REPO / '.github' / 'social-preview.png')], check=True,
                   stdout=subprocess.DEVNULL)
    from PIL import Image
    im = Image.open(png).convert('RGB')
    im.save(REPO / 'screenshots' / 'collage.jpg', 'JPEG', quality=90, subsampling=0, optimize=True)
    shutil.rmtree(picks, ignore_errors=True)
    log(f'collage {im.width}x{im.height} -> screenshots/collage.jpg; social preview -> .github/social-preview.png')


def probe_len(path: Path) -> float:
    return float(subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True, check=True).stdout.strip())


def live_session(work: Path, durations: dict, record: Path):
    """Not used. A new extension is invisible until a full shell restart, and
    disable/enable reloads every extension without loading the new code."""
    raise RuntimeError('live session driver is disabled')



STILLS = [
    ('title', ['01-panel-menu']),
    ('power', ['02-panel-menu-tooltip']),
    ('sound', ['01-panel-menu']),
    ('toggles', ['01-panel-menu']),
    ('apps', ['03-menu-apps']),
    ('clip', ['04-menu-clip']),
    ('sys', ['05-menu-sys', '07-confirm-dialog']),
    ('sudo', ['06-menu-sudo']),
    ('appearance', ['08-appearance-light', '08-appearance-dark']),
    ('files', ['09-files-right-click-copy', '09-files-right-click-open', '09-files-right-click-tools']),
    ('darkmode', ['08-appearance-dark']),
    ('general', ['10-settings-general-1', '11-settings-general-2']),
    ('menu', ['12-settings-menu-1', '13-settings-menu-2', '14-settings-menu-3', '15-settings-menu-4']),
    ('files_tab', ['16-settings-files-1', '17-settings-files-2']),
    ('about', ['18-settings-about-1', '19-settings-about-2']),
    ('end', ['01-panel-menu']),
]

STILL_CAPTIONS = {
    'power': 'Power: lock, log out, suspend, restart, power off',
    'sound': 'Sound: mute, volume down and up',
    'toggles': 'Quick toggles show their state',
    'apps': 'Apps & Files: Files, Settings, Trash, Recent files, right-click actions',
    'clip': "Clipboard & Screenshot — GNOME's own screenshot tool",
    'sys': 'Updates & System — risky actions always ask first',
    'sudo': 'Sudo Timeout — visudo-checked, with Forget Password Now',
    'appearance': 'Appearance: System, Light or Dark',
    'files': 'Files right-click menu: Scripts ▸ EaseHub ▸ Copy, Open, Tools',
    'darkmode': 'Dark Mode from the panel',
    'general': 'General — layout, appearance, icon, position, shortcut, terminal',
    'menu': 'Menu — show only the items you want',
    'files_tab': 'Files — rename, hide or regroup the right-click actions',
    'about': 'GNOME Shell 45–51 · Wayland and X11',
}


def stills_video(work: Path, voice, durations: dict):
    """Narrated video from the reviewed screenshots. Nothing is clicked."""
    shots = REPO / 'screenshots' / f'v{em.version()}'
    title = f'Comfort Control (EaseHub) {em.version()} — GNOME Shell {em.shell_range()}'
    pieces = []
    events = []
    cursor = 0.0
    for key, names in STILLS:
        paths = [shots / f'{name}.png' for name in names]
        missing = [p.name for p in paths if not p.exists()]
        if missing:
            raise RuntimeError(f'missing screenshots: {", ".join(missing)}')
        hold = max(2.8, (durations.get(key, 0) if durations else 0) + 0.45)
        each = hold / len(paths)
        caption = title if key == 'title' else (STILL_CAPTIONS.get(key) or (voice.lines.get(key) if voice else None))
        for i, path in enumerate(paths):
            clip = work / f'{key}-{i}.mp4'
            text = work / f'{key}-{i}.txt'
            if caption:
                text.write_text(caption, encoding='utf-8')
            vf = (
                'scale=1920:1200:force_original_aspect_ratio=decrease:flags=lanczos,'
                'pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x111318,setsar=1'
            )
            if caption:
                vf += (
                    f",drawtext=fontfile={em.FONT}:textfile={text}:fontsize=40:fontcolor=white:"
                    "box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-70"
                )
            subprocess.run([
                'ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-t', f'{each:.3f}', '-i', str(path),
                '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-r', '30', str(clip)], check=True)
            pieces.append(clip)
        if voice and key in voice.files:
            events.append((cursor + 0.2, str(voice.files[key])))
        cursor += hold
    silent = work / 'silent.mp4'
    concat_video(pieces, silent, preset='veryfast')
    return silent, events


def video(args):
    voice = None
    durations = {}
    if em.Voice.available():
        voice = em.Voice()
        voice.prepare()
        durations = dict(voice.lengths)
    else:
        log('Kokoro not installed: music only, no narration')
    out_mp4 = REPO / 'dist' / 'media' / f'easehub-v{em.version()}-demo.mp4'
    with workdir() as tmp:
        work = Path(tmp)
        # Motion is the nested shell: the menu opens, groups expand, appearance
        # changes, and Files walks its menus. Radio tiles are never clicked.
        # Settings cannot open in there, so those tabs are scrolled on this
        # desktop afterwards, in the window's left margin only.
        env = prepare(work, 'video', durations, parts='menu,files')
        raw = work / 'raw.mp4'
        log('recording live motion in the nested shell; Wi-Fi, Bluetooth, Airplane, power and sudo are not clicked')
        try:
            scenes, rec_start = run_session(work, env, raw)
        finally:
            shutil.rmtree(Path.home() / 'EaseHub Demo', ignore_errors=True)
        if not raw.exists() or raw.stat().st_size < 100000:
            raise RuntimeError(f'recording is empty: {raw}')
        # Settings opens on this desktop as soon as the nested tour ends, before
        # the encode, so the take does not sit idle. Hands off the mouse: the
        # pointer stays in the window's left margin and only scrolls.
        log('settings: each tab from the top to the bottom')
        settings = record_settings(work / 'settings', voice)
        title = f'Comfort Control (EaseHub) {em.version()} — GNOME Shell {em.shell_range()}'
        # Start on the title scene: before it the nested shell is still starting up.
        first = next((s for s in scenes if s['key'] == 'title'), None)
        t0 = max(0.0, (first['t'] - rec_start) / 1e6 - 0.3) if first else 0.0
        rec_start += t0 * 1e6
        end_t = None
        for sc in scenes:
            if sc['key'] == 'end':
                end_t = max(0.0, (sc['t'] - rec_start) / 1e6)
        body_scenes = [s for s in scenes if s['key'] != 'end']
        captions, events = [], []
        for i, sc in enumerate(body_scenes):
            start = max(0.0, (sc['t'] - rec_start) / 1e6)
            stop = max(0.0, (body_scenes[i + 1]['t'] - rec_start) / 1e6) if i + 1 < len(body_scenes) else (end_t if end_t else start + 5)
            text = title if sc['key'] == 'title' else sc['caption']
            if text:
                captions.append((start, max(stop - 0.2, start + 2.5), text))
            if voice and sc['key'] in voice.files:
                events.append((start, str(voice.files[sc['key']])))
        body = work / 'body.mp4'
        render(raw, body, captions, work / 'body-caps', ss=t0, to=end_t)
        body_len = probe_len(body)
        pieces = [body]
        if settings is not None:
            set_mp4, set_events = settings
            pieces.append(set_mp4)
            events.extend((body_len + t, wav) for t, wav in set_events)
            body_len += probe_len(set_mp4)
        if end_t is not None:
            end_sc = next(s for s in scenes if s['key'] == 'end')
            outro = work / 'outro.mp4'
            render(raw, outro, [(0.3, 5.5, end_sc['caption'] or title)], work / 'outro-caps', ss=t0 + end_t)
            pieces.append(outro)
            if voice and 'end' in voice.files:
                events.append((body_len, str(voice.files['end'])))
        silent = work / 'silent.mp4'
        concat_video(pieces, silent, preset='veryfast')
        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(silent, out_mp4.with_name(out_mp4.stem + '.video-only.mp4'))
        out_mp4.with_name(out_mp4.stem + '.voice.json').write_text(json.dumps(events))
        em.mix_audio(silent, events, out_mp4, work)
    log(f'video -> {out_mp4.relative_to(REPO)}')


def concat_video(parts: list[Path], dest: Path, preset: str = 'slow'):
    inputs = []
    for p in parts:
        inputs += ['-i', str(p)]
    fc = ''.join(f'[{i}:v]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=1:a=0[v]'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', fc, '-map', '[v]',
                    '-c:v', 'libx264', '-preset', preset, '-crf', '18', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart', '-r', '30', str(dest)], check=True)


def record_settings(work: Path, voice):
    """Record each Settings tab on the live desktop. Scrolls in the left margin only."""
    import prefs_shots as ps

    pages = [
        ('general', 'general', 'General — layout, appearance, icon, position, shortcut, terminal'),
        ('menu', 'menu', 'Menu — show only the items you want'),
        ('files', 'files_tab', 'Files — rename, hide or regroup the right-click actions'),
        ('about', 'about', 'GNOME Shell 45–51 · Wayland and X11'),
    ]
    work.mkdir(parents=True, exist_ok=True)
    saved = ps.gset('prefs-page')
    clips = []
    events = []
    cursor = 0.0
    try:
        sw, sh = (int(n) for n in subprocess.run(
            ['xdotool', 'getdisplaygeometry'], capture_output=True, text=True, check=True).stdout.split())
        for page, key, caption in pages:
            ps.close_existing()
            ps.gset('prefs-page', page)
            subprocess.Popen(['gnome-extensions', 'prefs', em.UUID])
            wid = ps.window()
            time.sleep(1.0)
            ps.sh('xdotool', 'windowsize', wid, str(ps.W), str(min(ps.H, sh - 80)))
            ps.sh('xdotool', 'windowmove', wid, str(max(0, (sw - ps.W) // 2)), '40')
            time.sleep(0.6)
            x, y, w, h = ps.geometry(wid)
            # GTK draws a transparent shadow margin around the window; recording it
            # would show whatever is on the desktop behind. Keep the visible window only.
            probe = work / f'{page}-frame.png'
            ps.sh('import', '-window', wid, str(probe))
            from PIL import Image
            box = Image.open(probe).convert('L').point(lambda v: 255 if v > 12 else 0).getbbox()
            probe.unlink(missing_ok=True)
            if box:
                x, y, w, h = x + box[0] + 2, y + box[1] + 2, box[2] - box[0] - 4, box[3] - box[1] - 4
            w -= w % 2
            h -= h % 2
            raw = work / f'{page}.mp4'
            rec = subprocess.Popen([
                'ffmpeg', '-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30',
                '-video_size', f'{w}x{h}', '-i', f"{os.environ.get('DISPLAY', ':0')}+{x},{y}",
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p',
                str(raw)], stdin=subprocess.PIPE)
            margin = str(x + 95)
            mid = str(y + h // 2)
            # Back to the top, hold it, then step down until the page stops moving.
            ps.sh('xdotool', 'mousemove', margin, mid)
            ps.sh('xdotool', 'click', '--repeat', '40', '--delay', '15', '4')
            time.sleep(1.3)
            prev = None
            for _ in range(8):
                probe = work / f'{page}-probe.png'
                ps.sh('import', '-window', wid, str(probe))
                fp = ps.content_hash(probe)
                probe.unlink(missing_ok=True)
                if prev is not None and fp == prev:
                    break
                prev = fp
                ps.sh('xdotool', 'mousemove', margin, mid)
                ps.sh('xdotool', 'click', '--repeat', '9', '--delay', '40', '5')
                time.sleep(1.15)
            time.sleep(0.7)
            rec.communicate(b'q', timeout=20)
            hold = probe_len(raw)
            clip = work / f'{page}-hd.mp4'
            render(raw, clip, [(0.2, hold - 0.2, caption)], work / f'cap-{page}')
            clips.append(clip)
            if voice and key in voice.files:
                events.append((cursor + 0.3, str(voice.files[key])))
            cursor += probe_len(clip)
        out = work / 'settings.mp4'
        concat_video(clips, out)
        return out, events
    except Exception as exc:
        log(f'settings recording skipped: {exc}')
        return None
    finally:
        try:
            ps.gset('prefs-page', saved)
            ps.close_existing()
        except Exception:
            pass


def render(raw: Path, out_mp4: Path, captions, work: Path, ss: float | None = None, to: float | None = None):
    """Scale to 1920x1200 and add captions. ss/to trim the source, in seconds."""
    work.mkdir(parents=True, exist_ok=True)
    chains = ['[0:v]scale=1920:1200:force_original_aspect_ratio=decrease:flags=lanczos,'
              'pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x111318,setsar=1[s0]']
    last = 's0'
    for i, (start, end, text) in enumerate(captions):
        tf = work / f'cap{i}.txt'
        tf.write_text(text, encoding='utf-8')
        chains.append(
            f"[{last}]drawtext=fontfile={em.FONT}:textfile={tf}:fontsize=40:fontcolor=white:"
            f"box=1:boxcolor=black@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-70:"
            f"enable='between(t,{start:.2f},{end:.2f})'[c{i}]")
        last = f'c{i}'
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg', '-y', '-loglevel', 'error']
    if ss is not None:
        cmd += ['-ss', f'{ss:.3f}']
    cmd += ['-i', str(raw)]
    if to is not None:
        cmd += ['-t', f'{to:.3f}']
    cmd += ['-filter_complex', ';'.join(chains), '-map', f'[{last}]', '-c:v', 'libx264', '-preset', 'veryfast',
            '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', str(out_mp4)]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['shots', 'video', 'all'])
    args = ap.parse_args()
    if args.command in ('shots', 'all'):
        shots(args)
    if args.command in ('video', 'all'):
        video(args)


if __name__ == '__main__':
    main()
