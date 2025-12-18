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
