# Contributing to Comfort Control (EaseHub)

Bug reports, ideas and pull requests are welcome. For security issues, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Layout

| Path | What it is |
| ---- | ---------- |
| `extension-esm.js` | Panel menu (shipped as `extension.js`) |
| `prefs-esm.js` | Preferences window (shipped as `prefs.js`) |
| `schemas/` | GSettings schema |
| `scripts/` | Shell reload (X11) and sudo timeout helpers |
| `create-release-zips.sh` | Builds `dist/comfort-control@nickotmazgin-<range>.shell-extension.zip` |
| `tools/nested-smoke-test.sh` | Runs the built zip in an isolated nested GNOME Shell |

## Development loop

```bash
./package.sh --install          # build and install for your user
./tools/nested-smoke-test.sh    # drive the menu in a nested shell; prints PASSED/FAILED
npx -y eslint@9 .               # lint (same as CI)
```

GNOME Shell caches extension code, so after installing, restart the shell to load it
(X11: Alt+F2, `r`, Enter; Wayland: log out and back in). The nested smoke test needs no
restart and never touches your real settings.

Preferences run in their own process, so `gnome-extensions prefs comfort-control@nickotmazgin`
shows `prefs.js` changes right away.

## Pull requests

- Keep `TERMINALS` in `extension-esm.js` and `TERMINAL_CHOICES` in `prefs-esm.js` in sync.
- Start processes with an argument list (`Gio.Subprocess`), never a command string.
- Add a `## <version> (<date>)` entry to `CHANGELOG.md` when you bump `version-name`.
- CI must pass: Validate, Lint (ESLint + ShellCheck) and CodeQL.
