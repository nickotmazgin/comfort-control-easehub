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
    display = ('MUTTER_DEBUG_DUMMY_MODE_SPECS=2400x1800 MUTTER_DEBUG_DUMMY_MONITOR_SCALES=2' if scale == 2
               else f'MUTTER_DEBUG_DUMMY_MODE_SPECS={SIZE[0]}x{SIZE[1]}')
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
{display} timeout {240 if mode == 'video' else 150} gnome-shell --nested --wayland || true
''')
    env = dict(os.environ, XDG_DATA_HOME=str(work / 'data'), XDG_CONFIG_HOME=str(work / 'config'),
               EASEHUB_SHOWCASE_OUT=str(out), EASEHUB_SHOWCASE_MODE=mode, EASEHUB_SHOWCASE_PARTS=parts, EASEHUB_SHOWCASE_SCALE=str(scale),
               EASEHUB_SHOWCASE_DEMO_DIR=str(demo),
               EASEHUB_SHOWCASE_DURATIONS=json.dumps(durations))
    return env


def nested_window(timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        for wid in subprocess.run(['xdotool', 'search', '--name', 'gnome-shell'],
                                  capture_output=True, text=True).stdout.split():
            info = subprocess.run(['xwininfo', '-id', wid], capture_output=True, text=True).stdout
            vals = {}
            for line in info.splitlines():
                line = line.strip()
                for k in ('Absolute upper-left X', 'Absolute upper-left Y', 'Width', 'Height'):
                    if line.startswith(k + ':'):
                        vals[k] = int(line.split(':')[1])
            if vals.get('Width') == SIZE[0] and vals.get('Height') == SIZE[1]:
                return vals['Absolute upper-left X'], vals['Absolute upper-left Y']
        time.sleep(0.3)
    raise RuntimeError('nested window not found')


def run_session(work: Path, env: dict, record: Path | None):
    """Run the nested session; with `record`, capture its window to that file."""
    logf = work / 'log.txt'
    proc = subprocess.Popen(['dbus-run-session', '--', 'bash', str(work / 'run.sh')], env=env,
                            stdout=open(logf, 'w'), stderr=subprocess.STDOUT, start_new_session=True)
    rec, rec_start = None, None
    try:
        if record:
            x, y = nested_window()
            rec = subprocess.Popen(
                ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '30',
                 '-video_size', f'{SIZE[0]}x{SIZE[1]}', '-i', f"{os.environ.get('DISPLAY', ':0')}+{x},{y}",
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
        env = prepare(work, 'video', durations)
        raw = work / 'raw.mp4'
        try:
            scenes, rec_start = run_session(work, env, raw)
        finally:
            shutil.rmtree(Path.home() / 'EaseHub Demo', ignore_errors=True)
        title = f'Comfort Control (EaseHub) {em.version()} — GNOME Shell {em.shell_range()}'
        captions, events = [], []
        for i, sc in enumerate(scenes):
            start = max(0.0, (sc['t'] - rec_start) / 1e6)
            end = (scenes[i + 1]['t'] - rec_start) / 1e6 if i + 1 < len(scenes) else start + 5
            text = title if sc['key'] == 'title' else sc['caption']
            if text:
                captions.append((start, max(end - 0.2, start + 2.5), text))
            if voice and sc['key'] in voice.files:
                events.append((start, str(voice.files[sc['key']])))
        render(raw, out_mp4, captions, work)
        silent = out_mp4.with_name(out_mp4.stem + '.video-only.mp4')
        shutil.copy2(out_mp4, silent)
        out_mp4.with_name(out_mp4.stem + '.voice.json').write_text(json.dumps(events))
        em.mix_audio(silent, events, out_mp4, work)
    log(f'video -> {out_mp4.relative_to(REPO)}')


def render(raw: Path, out_mp4: Path, captions, work: Path):
    """Scale the nested window to 1920x1200 and add captions."""
    chains = ['[0:v]scale=1920:1200:flags=lanczos[s0]']
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
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-filter_complex', ';'.join(chains),
                    '-map', f'[{last}]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart', '-r', '30', str(out_mp4)], check=True)


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
