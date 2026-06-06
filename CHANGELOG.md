## 1.0.8 (2026-06-06)

### Safety
- **Restart GNOME Shell** is now a **guide only** (Alt+F2 → r) — removed `Meta.restart` / `reexec_self` which could log you out on Zorin/GNOME 46

### Sudo Timeout submenu
- **Show status** uses login shell (`bash -lc`) so **sudo-show** alias works; falls back to `sudo-extend current`
- **Refresh sudo cache (sudo -v)** — new item
- Terminal stays open until you press Enter (fixed kgx path that closed in under a second)
- gnome-terminal uses `--wait` so preset/status output is readable

## 1.0.7 (2026-06-06)

### Fix
- **Restart GNOME Shell** — call `Meta.restart(message, global.context)` (GNOME 46 API); fallback to `global.reexec_self()`. Works on **X11**; shows a clear message on Wayland where restart is blocked.

## 1.0.6 (2026-06-06)

**Panel menu: Restart GNOME Shell + sudo-extend timeout submenu.**

### New menu actions
- **Restart GNOME Shell** — same as Alt+F2 → r; respects **Confirm dangerous actions**
- **Sudo Timeout** submenu — Show status, interactive menu, and presets (15 / 30 / 60 / 120 min) via terminal
- Auto-detects `~/.local/bin/sudo-extend` or PATH; optional custom path in Preferences → General

### Preferences
- **sudo-extend command** path field on General tab
- Actions toggles for **Restart GNOME Shell** and **Sudo Timeout submenu**
- Menu refreshes when Actions toggles change (no shell reload required)

## End of GNOME Shell 42–44 support — 2026-06-02

**EaseHub no longer builds, tests, or maintains a GNOME Shell 42–44 package.**

- Removed classic `extension.js` / `prefs.js` and dual-zip packaging
- `metadata.json` now lists **GNOME 45–50** only
- Removed legacy zip assets from GitHub Releases
- **Minimum supported Shell:** GNOME **45**

## 1.0.5 (2026-05-31)

**Current release for GNOME Shell 45–50 (ESM).**

### Fixes
- **Actions prefs:** removed blank toggle row in Links (GTK treated `About & README` as a mnemonic)
- Panel menu labels: **About and README**, **Donate (PayPal)** — no special characters

### About tab
- Developer, version, description, and full link set (repo, README, issues, releases, PayPal, email)

### Included from 1.0.4
- GNOME 45–50 ESM build for Shell 46+
- Release zip: `comfort-control@nickotmazgin-45-50`
- Compiled GSettings schemas in release artifact

Download only from [latest release](https://github.com/nickotmazgin/comfort-control-easehub/releases/latest).
