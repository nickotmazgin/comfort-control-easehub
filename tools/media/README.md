# Screenshots and demo video

Menu and Files shots, the collage, and the GitHub social preview are taken
inside a nested GNOME Shell. That session has its own settings database. It is
not isolated from NetworkManager, power, or sudo: those talk to the real
system. A pointer miss on a Wi-Fi tile turns the real radio off.

GNOME's rfkill service (gsd-rfkill) is not on the nested session's private
D-Bus, so EaseHub would hide its Bluetooth and Airplane Mode tiles.
[`showcase/mock_rfkill.py`](showcase/mock_rfkill.py) answers that interface
inside the nested session with in-memory values, so both tiles appear in the
shots and the video. It never touches a real radio.

Video frames hold only the nested Shell's own window and the Settings window
without its shadow margin, so nothing else on your desktop is recorded. The
video starts on the title scene.

`video` records that nested shell in motion (the menu, each group, appearance,
and the Files right-click walk), then scrolls every Settings tab on this
desktop. In video mode the pointer is not moved onto menu tiles. Clicks on
Wi-Fi, Bluetooth, Airplane Mode, Dark Mode, Night Light, Keep Awake, power,
and Sudo Timeout are refused.

```bash
python3 tools/media/showcase.py shots    # screenshots/v<version>/, collage, social preview
python3 tools/media/showcase.py video    # dist/media/easehub-v<version>-demo.mp4
python3 tools/media/showcase.py all
```

Settings tabs cannot open inside the nested shell. Capture them on the live
desktop with a scroll-only helper (it never clicks):

```bash
python3 tools/media/prefs_shots.py screenshots/v1.3.0 10
```

Keep your hands off the mouse for about 40 seconds while that runs. The pointer
stays in the window's left margin and only scrolls.

`EASEHUB_SHOWCASE_ONLY=menu` or `EASEHUB_SHOWCASE_ONLY=files` reruns one pass
and leaves the other screenshots in place. Menu shots render at 2×. Files
shots render at 1×, because Nautilus submenu offsets are wrong at 2×.

## What it captures

| File | Shows |
|---|---|
| 01 | Panel menu |
| 02 | Tooltip on a power button |
| 03–06 | Apps & Files, Clipboard, Updates, Sudo Timeout, each expanded |
| 07 | Confirm dialog (cancelled; Proceed is never pressed) |
| 08 | Appearance: Light, then Dark |
| 09 | Files right-click: Scripts ▸ EaseHub ▸ Copy, Open, Tools |
| 10–19 | Settings: General, Menu, Files, About |

The collage (`screenshots/collage.jpg`) and `.github/social-preview.png` are
rebuilt at the end of `showcase.py shots`. Review every PNG before committing.

## Narration and music

The video gets an English voice-over and a music bed. Both are free to use:

- **Voice:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT), run locally.
  Edit the lines in [`narration.py`](narration.py). Each scene waits for its line
  to finish.
- **Music:** [`make_music.py`](make_music.py) synthesises an original track
  (no samples, no third-party audio).

One-time setup (about 350 MB, kept in `~/.cache/clipflow-pro-media-tools`,
shared with ClipFlow Pro):

```bash
D=~/.cache/clipflow-pro-media-tools; mkdir -p "$D" && cd "$D"
python3 -m venv venv && ./venv/bin/pip install kokoro-onnx soundfile
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Without it, the video is still made, with music and no narration. Each scene
waits until its line would have finished, so a later take with the voice does
not start the next picture early.

## Safety

- Do not run `tools/media/easehub_media.py` to take shots or video. That older
  path clicks the real panel menu. `screenshots`, `video`, and `all` now refuse
  to start. `restore` and `remix` still work.
- `video` does open a nested shell. Wi-Fi, power, and Sudo Timeout still talk
  to the real system (Bluetooth and Airplane Mode go to the mock). The v1.3.0 tour missed
  Dark Mode and switched the real Wi-Fi radio off. Do not aim the pointer at
  those tiles. Video mode does not move it; screenshot mode may hover them
  and must not click them.
- After the nested tour, `video` scrolls Settings on this desktop. The pointer
  stays in the window's left margin. Leave the mouse alone until it finishes.
- After a nested run, delete `/run/user/$(id -u)/gnome-shell-disable-extensions`
  if it exists. Otherwise the next real login disables every extension.
- `showcase.py` removes that file itself when the nested shell is stopped.
- Never `pkill -f` a pattern that also matches the shell command you are running.
