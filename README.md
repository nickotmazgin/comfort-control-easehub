
---

# Comfort Control (EaseHub)

![EaseHub Screenshot](screenshots/easehub_showcase_final.png)

A GNOME Shell extension that brings **comfort and control to your desktop** — quick access to system actions, screenshot helpers, and update prompts.

---

## ✨ Features

* **Unified menu** for power actions: Lock, Logout, Suspend, Reboot, Power Off.
* **Screenshots made easy**:

  * Uses GNOME’s native Wayland screenshot UI when available.
  * Falls back to `gnome-screenshot` on Xorg or legacy setups.
* **Smart helpers**:

  * Shows exact install command for missing tools (APT, DNF, Zypper, Pacman, Flatpak).
  * Update dialogs open in your terminal for full control.

---

## 📦 Installation

### From [extensions.gnome.org (EGO)](https://extensions.gnome.org/)

*(Link will be added once published)*

### From GitHub Release

1. Download the latest `gnome-shell-easehub-v*.zip` from [Releases](https://github.com/nickotmazgin/comfort-control-easehub/releases).
2. Install it with GNOME Extensions:

   ```bash
   gnome-extensions install --force gnome-shell-easehub-v*.zip
   gnome-extensions enable comfort-control@nick-otmazgin
   ```

### From Source

```bash
uuid="comfort-control@nick-otmazgin"
git clone https://github.com/nickotmazgin/comfort-control-easehub.git \
  ~/.local/share/gnome-shell/extensions/"$uuid"
glib-compile-schemas ~/.local/share/gnome-shell/extensions/"$uuid"/schemas
gnome-extensions enable "$uuid"
```

On Wayland, if the shell doesn’t hot-reload, log out/in (or press **Alt+F2 → r** on Xorg).

---

## 🖼 Screenshots

See [screenshots/](screenshots/) for more visuals.

---

## 📝 License

[MIT License](LICENSE) © Nick Otmazgin

---

## ☕ Support & Donations

If you find EaseHub useful, consider supporting development 💙

* **PayPal** → [paypal.me/NickOtmazgin](https://www.paypal.me/NickOtmazgin)

---

