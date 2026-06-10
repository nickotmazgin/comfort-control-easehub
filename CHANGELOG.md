## 1.1.0 (2026-06-10)

**Reload GNOME Shell and Sudo Timeout return — rebuilt the safe way.**

The v1.0.6–1.0.8 versions of these features were withdrawn because calling
`Meta.restart()` from extension code could log out the session. v1.1.0 uses a
completely different, field-proven design:

### Reload GNOME Shell (X11 only)
- Triggers GNOME's own **Alt+F2 → r** restart path via `xdotool` — identical to
  doing it by hand, never calls `Meta.restart()` from the extension
- Verifies success from the Shell journal **and** a live D-Bus ping, then
  confirms with a desktop notification; reports failure without logging out
- Hidden automatically on Wayland (where an in-place shell restart is impossible)
- Requires `xdotool`; shows a friendly install hint if missing

### Sudo Timeout submenu
- Manage how long sudo remembers your password: status, 15/30/60/120/180 min,
  interactive menu, and reset to system default
- Runs in your preferred terminal with normal sudo authentication
- Every change is `visudo`-validated before install, written to a single
  drop-in (`/etc/sudoers.d/99-easehub-sudo-timeout-<user>`), backed up, and
  rolled back automatically if validation fails — a typo can never lock sudo
- Clear SUCCESS/ERROR output plus desktop notifications

### Menu & Preferences polish
- **EaseHub Settings…** entry at the bottom of the panel menu — always visible,
  so the settings window is reachable from the panel icon at all times
- New **Night Light** toggle (panel menu + Preferences → Actions → Toggles)
- Panel icon now uses GNOME's standard `system-status-icon` class for
  theme-correct sizing and padding
- Preferences: terminal picker moved to its own "Terminal" group (was
  mislabeled under "Safety"); About tab links to the new credits page
- Menu rebuilds live when actions are toggled in Preferences
- New "Power Tools" group in Preferences to enable/disable both features

## 1.0.9 (2026-06-06)

**Reverted experimental panel items — back to stable v1.0.5 menu.**

- Removed **Restart GNOME Shell** and **Sudo Timeout** submenu (v1.0.6–1.0.8)
- Restores the proven Lock/Logout/Power, updates, screenshots, and utilities menu

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
