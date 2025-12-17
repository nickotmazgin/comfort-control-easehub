# Comfort Control (EaseHub)

![EaseHub Screenshot](screenshots/easehub_showcase_final.png)

A **GNOME Shell extension** that brings **comfort and control to your desktop** — providing quick access to power actions, seamless screenshot helpers, and intelligent system update prompts.

---

## ✨ Features

### 🔋 **Power Control Hub**
* **Unified menu** with quick access to essential power actions:
  - 🔒 **Lock** - Secure your session instantly
  - 👋 **Logout** - Sign out safely
  - 💤 **Suspend** - Save power while keeping session
  - 🔄 **Reboot** - Restart your system
  - ⚡ **Power Off** - Shut down completely

### 📸 **Smart Screenshots**
* **Intelligent screenshot handling**:
  - Uses **GNOME's native Wayland** screenshot UI when available
  - **Automatic fallback** to `gnome-screenshot` on Xorg or legacy setups
  - **Seamless experience** across different display protocols

### 🛠️ **System Update Helpers**
* **Smart package management**:
  - **Cross-distro support**: APT, DNF, Zypper, Pacman, Flatpak
  - **Exact install commands** shown for missing tools
  - **Terminal integration** - updates run in your terminal for full visibility
  - **Secure authentication** using `pkexec` for graphical password prompts

### 🎯 **Compatibility**
* **Officially supports** GNOME Shell versions **42, 43, and 44**
* **Cross-platform** - Works on Wayland and Xorg
* **Lightweight** - Minimal resource usage

---

## 📦 Installation

### 📁 **From GitHub Release**

1. **Download** the latest `gnome-shell-easehub-v*.zip` from our [**Releases Page**](https://github.com/nickotmazgin/comfort-control-easehub/releases)

2. **Install** via GNOME Extensions app or terminal:
   ```bash
   gnome-extensions install --force gnome-shell-easehub-v*.zip
   gnome-extensions enable comfort-control@nickotmazgin
   ```

3. **Restart** GNOME Shell:
   - **Wayland**: Log out and back in
   - **Xorg**: Press **Alt+F2**, type `r`, and press Enter

### 🔧 **From Source (Developers)**

```bash
# Set extension UUID
uuid="comfort-control@nickotmazgin"

# Clone and install
git clone https://github.com/nickotmazgin/comfort-control-easehub.git \
  ~/.local/share/gnome-shell/extensions/"$uuid"

# Compile schemas
glib-compile-schemas ~/.local/share/gnome-shell/extensions/"$uuid"/schemas

# Enable extension
gnome-extensions enable "$uuid"
```

**Note**: On Wayland, you may need to log out/in for changes to take effect.

---

## 🖼️ **Screenshots & Visuals**

Explore more screenshots and visual examples in our [**screenshots/**](screenshots/) directory.

---

## 🤝 **Contributing**

We welcome contributions! Please feel free to:
- 🐛 **Report bugs** via [GitHub Issues](https://github.com/nickotmazgin/comfort-control-easehub/issues)
- 💡 **Suggest features** or improvements
- 🔧 **Submit pull requests** with enhancements
- 🌐 **Help with translations**

---

## 📄 **License**

This project is licensed under the [**MIT License**](LICENSE) © **Nick Otmazgin**

---

## ☕ **Support the Project**

If **EaseHub** enhances your GNOME experience, consider supporting its continued development:

💝 **[Support via PayPal](https://www.paypal.me/NickOtmazgin)** 

Your support helps maintain and improve this extension for the entire GNOME community! 💙

---

*Made with ❤️ for the GNOME community*
