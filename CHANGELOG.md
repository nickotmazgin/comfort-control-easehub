## 1.3.0 (2026-10-20)

**A compact new menu with sound, quick toggles, files and trash, plus EaseHub actions in the Files right-click menu.**

### New in the panel menu
- **Compact layout** (default): a row of power buttons, a volume row, quick-toggle tiles,
  four collapsible groups and a footer. About 10 rows tall instead of 23. **Classic**
  (one row per item) is still available in Preferences.
- **Volume**: mute, down, a slider and up for the current output device.
- **Quick toggles**: Wi-Fi, Bluetooth, Airplane Mode, Do Not Disturb, Dark Mode, Night Light
  and **Keep Awake** (stops the screen from blanking and the computer from sleeping while on).
  Tiles hide themselves when the hardware or service isn't there.
- **Apps & Files**: Open Files, Settings, Extensions, Tweaks, Terminal, **Empty Trash** (shows
  how many items and asks first) and **Clear Recent Files** (asks first).
- **Sudo Timeout**: the menu shows the current value (e.g. "Sudo Timeout (60 min)"), adds
  **Forget Password Now** and a **custom minutes** entry, and can optionally share one login
  across all terminals (`timestamp_type=global`, off by default).
- **New panel icon** (a hub), with a choice of icons, panel position and order in Preferences.
- **Appearance**: System (follows your shell theme), Light or Dark for the EaseHub menu and
  its tooltips, so it fits any theme.
- **Files Right-Click Actions** switch and a **Files Right-Click Settings…** shortcut right in
  the Apps & Files group.
- Tiles update live if Dark Mode, Do Not Disturb or Night Light change elsewhere while the
  menu is open.
- **Keyboard shortcut** to open the menu (none by default).

### Files right-click menu (optional, off by default)
- Preferences → **Files** adds actions under **Scripts ▸ EaseHub** in Files (Nautilus):
  Copy Name, Full Path, Path and Name, Parent Folder Path, Path from Home (~), Quoted Path
  (shell-safe), File URI; Open Terminal Here, Open in Editor; Copy Size and Type, Copy
  SHA-256 Checksum, Make Executable.
- Grouped (Copy ▸ / Open ▸ / Tools ▸, with short names like "Full Path" inside Copy) or flat;
  rename the menu or any action; hide actions;
  notifications on or off; choose the editor. Uses your EaseHub terminal.
- Works with symbolic links (copies the path you clicked, not its target), broken links,
  spaces, quotes and non-Latin names. Sizes are real file sizes.
- EaseHub only removes files it created (listed in a marker file); anything you add yourself
  is kept. Turning the option off removes the menu.

- **Tooltips** on every icon-only control, with the full name and current state
  (e.g. "Do Not Disturb: Off", "Volume: 70%", "Log Out…" when it will ask first).
- Tiles share equal widths, so a short last row lines up.

### Reliability and messages
- Reload GNOME Shell: stops with a clear message when the Alt+F2 dialog is disabled by policy,
  waits longer for the dialog on a busy shell, and verifies the restart even where the
  shell does not run as the `org.gnome.Shell@x11.service` user unit.
- Notifications use consistent "Could not …" wording, name what failed to open, and all
  helper-script notifications are labelled EaseHub. Files actions show the action as the
  title and the file below it; errors show even when Files notifications are off.

### Preferences
- New **Menu** page to show or hide every item, and a **Files** page. Preferences reopen on
  the page you used last.
- **Reset all settings** (with confirmation) and **Show All Items** / **Restore Default Names
  and Actions** buttons.
- Settings from 1.2 and earlier are migrated: items you had hidden stay hidden, and new
  items appear.

### Under the hood
- GNOME 48+ `St.BoxLayout` orientation handled for 51 (where `vertical` was removed).
- Tiles keep a compact size on the stock GNOME theme (which gives quick toggles a fixed width).
- CI runs a unit test for the Files menu writer.

## 1.2.0 (2026-10-20)

**GNOME Shell 51, live toggle switches, and fixes for terminals and screenshots.**

### Fixes
- **Terminal windows closed too early.** The "Press ENTER to close" step was split into
  separate arguments and never ran, so the window for **Check System Updates**, upgrades,
  Flatpak updates and **Sudo Timeout → Show Status** closed as soon as the command ended.
  Commands now stay open and show their exit code.
- **Screenshot opened the old tool.** The menu item called a screenshot method that doesn't
  exist, so it always fell back to `gnome-screenshot` (or asked you to install it). It now
  opens GNOME's built-in screenshot UI, the same way GNOME's own screenshot button does.
- **Preferred terminal was ignored for Konsole, Alacritty, WezTerm, foot and Ptyxis.** They
  passed the safety check but had no launch rule, so another terminal opened instead. All ten
  supported terminals now launch correctly.
- **Sudo Timeout had no effect for user names with a dot** (e.g. `john.doe`): sudo skips
  `sudoers.d` files with a `.` in the name. The drop-in name now replaces such characters
  with `_`.
- **About → Description was blank** because the `&` in it was read as markup.
- **About and README** and **Donate** can now be hidden in Preferences → Actions → Links.

### New
- **GNOME Shell 51** support (now 45–51). Checked against the GNOME 51 porting guide; uses the
  new `PopupMenu.close()` parameters on 51.
- **Do Not Disturb, Dark Mode and Night Light are switches** that show the current state and
  update every time the menu opens. Dark Mode switches between dark and GNOME's default style.
- **Check System Updates lists available updates** after refreshing (APT, Zypper), and uses
  `checkupdates` on Arch instead of `pacman -Sy`, which risks a partial upgrade.
- **Update Flatpaks** tells you if Flatpak isn't installed.
- Preferences: modern switch and drop-down rows, search, every supported terminal in the
  terminal list (with a note if your choice isn't installed), a **Show All Actions** button,
  a Changelog link and a **More by Nick Otmazgin** group.

### Under the hood
- Every process starts from an argument list (`Gio.Subprocess`) instead of a parsed command
  line.
- Settings for DND / Dark Mode / Night Light are only opened if their schema is installed (a
  missing schema would otherwise crash the shell).
- An open confirmation dialog is closed when the extension is disabled.
- Release zip is now `comfort-control@nickotmazgin-45-51.shell-extension.zip`; its name
  follows `shell-version` in `metadata.json`. `package.sh` now includes the helper scripts.
- CI: ESLint, ShellCheck, script syntax checks, a check that every shipped file is in the zip,
  and a check that CHANGELOG has an entry for the version.

> **Recommended upgrade** from v1.1.4 and earlier.

## 1.1.4 (2026-08-30)

**Polish release — safer suspend + session/docs alignment.**

- Confirm **Suspend** like Reboot/Power Off when dangerous-action prompts are enabled
- Metadata and About text: **Wayland & X11/Xorg** validated
- README, release notes, and compatibility wording aligned to v1.1.4

> **Recommended upgrade** from v1.1.3 and earlier.

## 1.1.3 (2026-06-11)

**Security hardening and safer update prompts.**

- Whitelist terminal emulators in preferences (blocks arbitrary command injection via
  tampered `preferred-terminal` settings)
- Add confirmation dialogs for **Upgrade System Packages** and **Update Flatpaks**
- CI validates bundled `easehub-reload-shell.sh` and `easehub-sudo-extend.sh` in release zips
- Expand `SECURITY.md` threat-model documentation

> **Recommended upgrade** from v1.1.2 and earlier.

## 1.1.2 (2026-06-11)

**Fix power/session actions on GNOME 45–50.**

> **Recommended upgrade** from v1.1.1 if Lock, Log Out, Reboot, Power Off, or
> Suspend did not work on your system.

The Lock / Log Out / Reboot / Power Off / Suspend items were calling removed or
mismatched `org.gnome.SessionManager` D-Bus methods (`PowerOff`, `Suspend`, etc.)
and coerced every argument to a boolean — so **Power Off**, **Reboot**, **Suspend**,
and **Log Out** could fail on current GNOME (e.g. Shell 46 on Zorin OS 18.1).

EaseHub now uses GNOME Shell's built-in **SystemActions** API (the same path as the
official power menu and Zorin Menu): `activateLockScreen`, `activateLogout`,
`activateRestart`, `activatePowerOff`, and `activateSuspend`.

## 1.1.1 (2026-06-10)

**Reload GNOME Shell and Sudo Timeout return — rebuilt the safe way.**

> **Superseded by v1.1.2** (2026-06-11) for **Lock**, **Log Out**, **Reboot**,
> **Power Off**, and **Suspend** on GNOME 45–50 — those items could fail on
> current Shell (e.g. 46 on Zorin OS 18.1) due to outdated session D-Bus calls.
> v1.1.1 stays on the Releases page for history and rollback; use
> [v1.1.2](https://github.com/nickotmazgin/comfort-control-easehub/releases/tag/v1.1.2)
> for power/session actions.

*(Briefly published as v1.1.0 the same day; that release was withdrawn and
replaced by v1.1.1, which adds the Settings menu entry, Night Light toggle,
and preferences polish below.)*

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
