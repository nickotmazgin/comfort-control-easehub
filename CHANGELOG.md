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
