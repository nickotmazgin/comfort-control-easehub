## 1.0.3 (2025-12-18)

Improvements
- Terminal support: add Kitty (`kitty`) to preferred terminal and fallbacks.
- Release: dual artifacts (42–44 and 45–47) with compiled schemas, checksums in notes.
- Governance: branch protection refined; discussions announcement updated.

Notes
- v1.0.2 resolved the `gschemas.compiled` packaging error; 1.0.3 adds polish.

---

## 1.0.2 (2025-12-18)

Fixes
- Release workflow compiles schemas before packaging so `schemas/gschemas.compiled` ships inside the zip. This resolves "GLib.FileError: Failed to open gschemas.compiled" on GNOME 42–44 when installing from GitHub zip.

---

## 1.0.1 (2025-12-17)

Highlights
- Added About & Donate in Preferences, plus README and PayPal links.
- New toggleable actions with granular control (About, Donate, Clear Primary).
- Preferred terminal setting used for commands and Open Terminal.
- Cross-distro update helpers (APT, DNF, Zypper, Pacman) with pkexec.
- Fixed D-Bus proxy usage (SessionManager + ScreenSaver) for stability.
- Expanded GNOME compatibility to 42–47.
- README: Support links (GitHub Sponsors + PayPal), contact info.

Notes
- Schema changed: new keys `preferred-terminal`, and defaults include new actions.
- Run `glib-compile-schemas schemas` after updating.
