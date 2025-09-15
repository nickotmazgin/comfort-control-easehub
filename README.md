# Comfort Control (EaseHub)
A GNOME extension for unified screenshot and update helpers.

## Features
- Uses GNOME’s native Wayland screenshot UI when available, falls back to gnome-screenshot.
- Shows install command for your distro if missing (APT/DNF/Zypper/Pacman).
- Update helpers open in terminal with confirmation.

## Install (from source)
uuid='comfort-control@nick-otmazgin'
git clone https://github.com/nickotmazgin/comfort-control-easehub.git   ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions//schemas
gnome-extensions enable 

