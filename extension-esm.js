// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) — GNOME 45+ (ESM)
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import NM from 'gi://NM';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import { PopupAnimation } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { syncFilesMenu } from './lib/filesMenu.js';

const REPO_URL = 'https://github.com/nickotmazgin/comfort-control-easehub';
const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW';
const SHELL_MAJOR = parseInt(PACKAGE_VERSION, 10);
const RFKILL_IFACE = 'org.gnome.SettingsDaemon.Rfkill';
const INHIBIT_SUSPEND = 4;
const INHIBIT_IDLE = 8;
const VOLUME_STEP = 0.05;

// Action ids that existed before 1.3, used to migrate 'enabled-actions'.
const LEGACY_ACTIONS = [
    'lock', 'logout', 'reboot', 'poweroff', 'suspend', 'dnd', 'darkmode', 'night-light',
    'settings', 'extensions', 'tweaks', 'open-terminal', 'shell-reload', 'sudo-extend',
    'clipboard-clear', 'clipboard-clear-primary', 'screenshot', 'apt-update', 'apt-upgrade',
    'flatpak-update', 'about-readme', 'donate',
];

function _notify(body) {
    Main.notify('EaseHub', body);
}

// Spawns an argv array directly (no shell parsing), so titles and paths with
// spaces or quotes can never be split into extra arguments.
function _spawnArgv(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        return true;
    } catch (e) {
        console.error('[EaseHub] spawn error:', e);
        _notify(`Could not start ${argv[0]}`);
        return false;
    }
}

function _openUri(uri, what) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.error('[EaseHub] open URI error:', e);
        _notify(`Could not open ${what}`);
    }
}

function _which(name) {
    try {
        return GLib.find_program_in_path(name) !== null;
    } catch {
        return false;
    }
}

function _isWayland() {
    // GNOME 50+ has no X11 compositor; treat a missing API as Wayland.
    try {
        return Meta.is_wayland_compositor?.() ?? true;
    } catch {
        return true;
    }
}

// Creating Gio.Settings for a schema that is not installed aborts the whole
// shell, so always look the schema up first.
function _settingsFor(schemaId) {
    const source = Gio.SettingsSchemaSource.get_default();
    if (!source?.lookup(schemaId, true))
        return null;
    return new Gio.Settings({ schema_id: schemaId });
}

function _icon(...names) {
    return new Gio.ThemedIcon({ names });
}

// GNOME 48 replaced St.BoxLayout's 'vertical' with 'orientation'; 51 removed 'vertical'.
function _box(vertical, params = {}) {
    if (SHELL_MAJOR >= 48) {
        return new St.BoxLayout({
            ...params,
            orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        });
    }
    return new St.BoxLayout({ ...params, vertical });
}

// argv builders per terminal: (title, commandArgv) => full argv.
// Keep the keys in sync with TERMINAL_CHOICES in prefs-esm.js.
const TERMINALS = {
    'ptyxis':              (t, c) => ['ptyxis', '--new-window', '--', ...c],
    'kgx':                 (t, c) => ['kgx', `--title=${t}`, '--', ...c],
    'gnome-terminal':      (t, c) => ['gnome-terminal', `--title=${t}`, '--', ...c],
    'konsole':             (t, c) => ['konsole', '-p', `tabtitle=${t}`, '-e', ...c],
    'tilix':               (t, c) => ['tilix', '-t', t, '-e', c.map(a => GLib.shell_quote(a)).join(' ')],
    'kitty':               (t, c) => ['kitty', '--title', t, ...c],
    'alacritty':           (t, c) => ['alacritty', '--title', t, '-e', ...c],
    'wezterm':             (t, c) => ['wezterm', 'start', '--', ...c],
    'foot':                (t, c) => ['foot', `--title=${t}`, ...c],
    'x-terminal-emulator': (t, c) => ['x-terminal-emulator', '-T', t, '-e', ...c],
};

function _resolveTerminal(settings) {
    const pref = (settings.get_string('preferred-terminal') || '').trim();
    if (pref && Object.hasOwn(TERMINALS, pref) && _which(pref))
        return pref;
    return Object.keys(TERMINALS).find(name => _which(name)) ?? '';
}

// Opens a terminal. With a command, runs it through bash and keeps the window
// open afterwards so the output (and exit code) can be read.
function _runInTerminal(settings, title, command = null) {
    const term = _resolveTerminal(settings);
    if (!term) {
        _notify('Could not find a supported terminal. Install GNOME Console or GNOME Terminal.');
        return;
    }
    if (!command) {
        _spawnArgv([term]);
        return;
    }
    const script = `${command}
status=$?
echo
read -r -p "Finished (exit code $status). Press ENTER to close. " _`;
    _spawnArgv(TERMINALS[term](title, ['bash', '-c', script]));
}

function _legacyScreenshot() {
    if (!_which('gnome-screenshot')) {
        let cmd = 'sudo apt install gnome-screenshot';
        if (_which('dnf'))    cmd = 'sudo dnf install gnome-screenshot';
        if (_which('zypper')) cmd = 'sudo zypper install gnome-screenshot';
        if (_which('pacman')) cmd = 'sudo pacman -S --needed gnome-screenshot';
        _notify(`Screenshots are unavailable. Install gnome-screenshot: ${cmd}`);
        return;
    }
    _notify('Opening the older screenshot tool (gnome-screenshot)');
    _spawnArgv(['gnome-screenshot', '-i']);
}

function _checkUpdatesCommand() {
    if (_which('apt'))
        return 'pkexec apt update && echo && apt list --upgradable';
    if (_which('dnf'))
        return 'dnf check-update';
    if (_which('zypper'))
        return 'pkexec zypper refresh && zypper list-updates';
    if (_which('pacman')) {
        // "pacman -Sy" without -u is a partial-upgrade risk on Arch;
        // checkupdates syncs a private database copy instead.
        if (_which('checkupdates'))
            return 'checkupdates';
        return 'echo "Install pacman-contrib to check for updates safely (checkupdates)."';
    }
    return 'echo "No supported package manager found."';
}

function _upgradeCommand() {
    if (_which('apt'))    return 'pkexec apt upgrade -y';
    if (_which('dnf'))    return 'pkexec dnf upgrade -y';
    if (_which('zypper')) return 'pkexec zypper update -y';
    if (_which('pacman')) return 'pkexec pacman -Syu --noconfirm';
    return 'echo "No supported package manager found."';
}

const EMPTY_XBEL = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0"
      xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks"
      xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info"
></xbel>
`;

function _sudoStateFile() {
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'easehub', 'sudo-timeout']));
}

// Hover/focus tooltips for icon-only controls, styled like the dash labels.
class Tooltips {
    constructor() {
        this._label = null;
        this._timeoutId = 0;
    }

    add(actor, text) {
        const show = () => this._schedule(actor, text);
        actor.connect('notify::hover', () => (actor.hover ? show() : this.hide()));
        actor.connect('key-focus-in', show);
        actor.connect('key-focus-out', () => this.hide());
        actor.connect('button-press-event', () => {
            this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
        actor.connect('destroy', () => this.hide());
    }

    _schedule(actor, text) {
        this.hide();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            this._timeoutId = 0;
            this._show(actor, typeof text === 'function' ? text() : text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(actor, text) {
        if (!actor.mapped || !text)
            return;
        this._label = new St.Label({ style_class: 'dash-label easehub-tooltip', text });
        Main.uiGroup.add_child(this._label);
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const [, lw] = this._label.get_preferred_width(-1);
        const [, lh] = this._label.get_preferred_height(-1);
        const monitor = Main.layoutManager.findMonitorForActor(actor) ?? Main.layoutManager.primaryMonitor;
        const gap = 6;
        let lx = Math.round(x + w / 2 - lw / 2);
        lx = Math.max(monitor.x + gap, Math.min(lx, monitor.x + monitor.width - lw - gap));
        let ly = Math.round(y + h + gap);
        if (ly + lh > monitor.y + monitor.height)
            ly = Math.round(y - lh - gap);
        this._label.set_position(lx, ly);
    }

    hide() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._label?.destroy();
        this._label = null;
    }
}

const EaseHubIndicator = GObject.registerClass(
class EaseHubIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'EaseHub');
        this._ext = extension;
        this._settings = extension.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._signals = [];       // [object, id] pairs disconnected on destroy
        this._toggles = [];       // toggle defs plus their widget
        this._layoutTiles = null;
        this._dialog = null;
        this._inhibitCookie = null;
        this._sudoLabel = null;
        this._volume = null;
        this._tooltips = new Tooltips();

        this._panelIcon = new St.Icon({ style_class: 'system-status-icon easehub-icon' });
        this.add_child(this._panelIcon);
        this._updatePanelIcon();

        this._connect(this._settings, 'changed', (_s, key) => this._onSettingChanged(key));
        this._connect(this.menu, 'open-state-changed', (_menu, open) => {
            if (open)
                this._onMenuOpened();
            else
                this._tooltips.hide();
        });

        // Desktop settings behind the DND / Dark Mode / Night Light tiles, watched
        // so the tiles stay right even if they change while the menu is open.
        this._gs = {
            notif: _settingsFor('org.gnome.desktop.notifications'),
            iface: _settingsFor('org.gnome.desktop.interface'),
            color: _settingsFor('org.gnome.settings-daemon.plugins.color'),
        };
        for (const [obj, key] of [[this._gs.notif, 'show-banners'], [this._gs.iface, 'color-scheme'], [this._gs.color, 'night-light-enabled']]) {
            if (obj)
                this._connect(obj, `changed::${key}`, () => this._syncToggles());
        }

        this._initBackends();
        this._buildMenu();
    }

    _connect(obj, signal, cb) {
        this._signals.push([obj, obj.connect(signal, cb)]);
    }

    destroy() {
        this._tooltips.hide();
        this._cancellable.cancel();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._disconnectVolume();
        this._dialog?.close();
        this._dialog = null;
        this._setKeepAwake(false);
        this._toggles = [];
        super.destroy();
    }

    _onSettingChanged(key) {
        if (key === 'files-actions-enabled')
            this._filesSwitch?.setToggleState(this._settings.get_boolean(key));
        else if (key === 'panel-icon')
            this._updatePanelIcon();
        else if (['menu-layout', 'hidden-actions', 'sudo-custom-minutes'].includes(key))
            this._buildMenu();
    }

    _updatePanelIcon() {
        const name = this._settings.get_string('panel-icon');
        if (!name || name === 'easehub') {
            const path = GLib.build_filenamev([this._ext.path, 'icons', 'easehub-symbolic.svg']);
            this._panelIcon.gicon = Gio.FileIcon.new(Gio.File.new_for_path(path));
        } else {
            this._panelIcon.gicon = _icon(name, 'system-run-symbolic');
        }
    }

    // ------------------------------------------------------------ backends

    _initBackends() {
        // Wi-Fi: NetworkManager. The toggle hides when there is no Wi-Fi device.
        NM.Client.new_async(this._cancellable, (_o, res) => {
            try {
                this._nm = NM.Client.new_finish(res);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.log('[EaseHub] NetworkManager unavailable:', e.message);
                return;
            }
            for (const sig of ['notify::wireless-enabled', 'notify::wireless-hardware-enabled', 'device-added', 'device-removed'])
                this._connect(this._nm, sig, () => this._syncToggles());
            this._syncToggles();
        });

        // Bluetooth and airplane mode: GNOME's rfkill service (no password needed).
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            RFKILL_IFACE, '/org/gnome/SettingsDaemon/Rfkill', RFKILL_IFACE, this._cancellable, (_o, res) => {
                try {
                    this._rfkill = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.log('[EaseHub] rfkill service unavailable:', e.message);
                    return;
                }
                this._connect(this._rfkill, 'g-properties-changed', () => this._syncToggles());
                this._syncToggles();
            });
    }

    _rfkillGet(name) {
        return this._rfkill?.get_cached_property(name)?.unpack() ?? null;
    }

    _rfkillSet(name, value) {
        this._rfkill?.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [RFKILL_IFACE, name, GLib.Variant.new_boolean(value)]),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error(`[EaseHub] rfkill ${name} error:`, e);
                        _notify('Could not change the radio setting');
                    }
                }
            });
    }

    _hasWifiDevice() {
        return this._nm?.get_devices().some(d => d.get_device_type() === NM.DeviceType.WIFI) ?? false;
    }

    _setWifi(on) {
        this._nm?.dbus_set_property(NM.DBUS_PATH, NM.DBUS_INTERFACE, 'WirelessEnabled',
            GLib.Variant.new_boolean(on), -1, this._cancellable, (client, res) => {
                try {
                    client.dbus_set_property_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error('[EaseHub] Wi-Fi error:', e);
                        _notify('Could not change Wi-Fi');
                    }
                }
            });
    }

    _setKeepAwake(on) {
        if (on && this._inhibitCookie === null) {
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Inhibit',
                new GLib.Variant('(susu)', ['easehub', 0, 'Keep Awake (EaseHub)', INHIBIT_SUSPEND | INHIBIT_IDLE]),
                new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, this._cancellable, (conn, res) => {
                    try {
                        [this._inhibitCookie] = conn.call_finish(res).deep_unpack();
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            console.error('[EaseHub] Keep Awake error:', e);
                            _notify('Could not keep the computer awake');
                        }
                        return;
                    }
                    this._syncToggles();
                });
        } else if (!on && this._inhibitCookie !== null) {
            const cookie = this._inhibitCookie;
            this._inhibitCookie = null;
            // Not cancellable: this must also run while the extension is being disabled.
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Uninhibit', new GLib.Variant('(u)', [cookie]),
                null, Gio.DBusCallFlags.NONE, -1, null, null);
        }
    }

    // Quick toggles: id, label, icon, and how to detect/read/write them.
    _toggleDefs() {
        const { notif, iface, color } = this._gs;
        return [
            {
                id: 'wifi', label: 'Wi-Fi', icon: ['network-wireless-symbolic'],
                available: () => this._hasWifiDevice() && this._nm.wireless_hardware_enabled,
                get: () => this._nm?.wireless_enabled ?? false,
                set: on => this._setWifi(on),
            },
            {
                id: 'bluetooth', label: 'Bluetooth', icon: ['bluetooth-active-symbolic'],
                available: () => this._rfkillGet('BluetoothHasAirplaneMode') === true &&
                    !this._rfkillGet('BluetoothHardwareAirplaneMode'),
                get: () => this._rfkillGet('BluetoothAirplaneMode') === false,
                set: on => this._rfkillSet('BluetoothAirplaneMode', !on),
            },
            {
                id: 'airplane', label: 'Airplane Mode', short: 'Airplane', icon: ['airplane-mode-symbolic'],
                available: () => this._rfkillGet('ShouldShowAirplaneMode') === true,
                get: () => this._rfkillGet('AirplaneMode') === true,
                set: on => this._rfkillSet('AirplaneMode', on),
            },
            {
                id: 'dnd', label: 'Do Not Disturb', short: 'Silent', icon: ['notifications-disabled-symbolic'],
                available: () => !!notif,
                get: () => !notif.get_boolean('show-banners'),
                set: on => notif.set_boolean('show-banners', !on),
            },
            {
                id: 'darkmode', label: 'Dark Mode', short: 'Dark', icon: ['dark-mode-symbolic', 'weather-clear-night-symbolic'],
                available: () => !!iface,
                get: () => iface.get_string('color-scheme') === 'prefer-dark',
                // 'default' is what GNOME's own quick setting uses for light.
                set: on => iface.set_string('color-scheme', on ? 'prefer-dark' : 'default'),
            },
            {
                id: 'night-light', label: 'Night Light', short: 'Night', icon: ['night-light-symbolic'],
                available: () => !!color,
                get: () => color.get_boolean('night-light-enabled'),
                set: on => color.set_boolean('night-light-enabled', on),
            },
            {
                id: 'keep-awake', label: 'Keep Awake', short: 'Awake', icon: ['my-caffeine-on-symbolic', 'preferences-desktop-screensaver-symbolic'],
                available: () => true,
                get: () => this._inhibitCookie !== null,
                set: on => this._setKeepAwake(on),
            },
        ];
    }

    _syncToggles() {
        for (const t of this._toggles) {
            let available = false;
            try {
                available = t.available();
            } catch {}
            t.widget.visible = available;
            if (!available)
                continue;
            try {
                const on = t.get();
                if (t.widget instanceof PopupMenu.PopupSwitchMenuItem)
                    t.widget.setToggleState(on);
                else
                    t.widget.checked = on;
            } catch (e) {
                console.error(`[EaseHub] ${t.id} sync error:`, e);
            }
        }
        this._layoutTiles?.();
    }

    // ------------------------------------------------------------ volume

    _connectVolume(slider, muteButton) {
        const control = Volume.getMixerControl();
        const v = { control, slider, muteButton, stream: null, streamIds: [], updating: false };
        this._volume = v;
        v.controlIds = [
            control.connect('default-sink-changed', () => this._bindVolumeStream()),
            control.connect('state-changed', () => this._bindVolumeStream()),
        ];
        v.sliderId = slider.connect('notify::value', () => {
            if (v.updating || !v.stream)
                return;
            v.stream.volume = Math.round(slider.value * control.get_vol_max_norm());
            v.stream.push_volume();
            if (v.stream.is_muted && slider.value > 0)
                v.stream.change_is_muted(false);
            this._syncVolumeIcon();
        });
        this._bindVolumeStream();
    }

    _bindVolumeStream() {
        const v = this._volume;
        if (!v)
            return;
        for (const id of v.streamIds)
            v.stream?.disconnect(id);
        v.streamIds = [];
        v.stream = v.control.get_state() === Gvc.MixerControlState.READY ? v.control.get_default_sink() : null;
        if (v.stream) {
            v.streamIds.push(v.stream.connect('notify::volume', () => this._syncVolume()));
            v.streamIds.push(v.stream.connect('notify::is-muted', () => this._syncVolume()));
        }
        this._syncVolume();
    }

    _syncVolume() {
        const v = this._volume;
        if (!v)
            return;
        v.updating = true;
        const muted = !v.stream || v.stream.is_muted;
        v.slider.value = v.stream && !muted ? Math.min(1, v.stream.volume / v.control.get_vol_max_norm()) : 0;
        v.slider.reactive = !!v.stream;
        v.updating = false;
        this._syncVolumeIcon();
    }

    _syncVolumeIcon() {
        const v = this._volume;
        const muted = !v.stream || v.stream.is_muted;
        const level = v.slider.value;
        v.muteButton.child.icon_name = muted || level === 0 ? 'audio-volume-muted-symbolic'
            : level < 0.34 ? 'audio-volume-low-symbolic'
                : level < 0.67 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
        v.muteButton.accessible_name = muted ? 'Unmute' : 'Mute';
    }

    _stepVolume(delta) {
        const v = this._volume;
        if (v?.stream)
            v.slider.value = Math.max(0, Math.min(1, v.slider.value + delta));
    }

    _toggleMute() {
        const s = this._volume?.stream;
        if (s)
            s.change_is_muted(!s.is_muted);
    }

    _disconnectVolume() {
        const v = this._volume;
        if (!v)
            return;
        for (const id of v.streamIds)
            v.stream?.disconnect(id);
        for (const id of v.controlIds)
            v.control.disconnect(id);
        v.slider.disconnect(v.sliderId);
        this._volume = null;
    }

    // ------------------------------------------------------------ actions

    _confirm(label, cb) {
        if (!this._settings.get_boolean('confirm-dangerous')) {
            cb();
            return;
        }
        this._dialog?.close();
        const d = new ModalDialog.ModalDialog({ styleClass: 'prompt-dialog' });
        d.contentLayout.add_child(new St.Label({ text: `${label}?`, x_align: Clutter.ActorAlign.CENTER }));
        d.addButton({ label: 'Cancel', action: () => d.close(), key: Clutter.KEY_Escape });
        d.addButton({ label: 'Proceed', action: () => { d.close(); cb(); }, default: true });
        d.connect('closed', () => {
            if (this._dialog === d)
                this._dialog = null;
        });
        this._dialog = d;
        d.open();
    }

    _script(name) {
        return GLib.build_filenamev([this._ext.path, 'scripts', name]);
    }

    _reloadShell() {
        if (_isWayland()) {
            _notify('Reload is only available on X11. On Wayland, log out and back in instead.');
            return;
        }
        const script = this._script('easehub-reload-shell.sh');
        if (!GLib.file_test(script, GLib.FileTest.EXISTS)) {
            _notify('Reload script is missing from the extension install.');
            return;
        }
        if (!_which('xdotool')) {
            _notify('xdotool is required for shell reload. Install it first (e.g. sudo apt install xdotool).');
            return;
        }
        // The script triggers GNOME's own Alt+F2 "r" restart and verifies it
        // from the journal and D-Bus. It never calls Meta.restart() directly.
        _spawnArgv(['bash', script]);
    }

    _sudo(args, inTerminal = true) {
        const script = this._script('easehub-sudo-extend.sh');
        if (!GLib.file_test(script, GLib.FileTest.EXISTS)) {
            _notify('Sudo timeout script is missing from the extension install.');
            return;
        }
        if (inTerminal)
            _runInTerminal(this._settings, 'Sudo Timeout', `bash ${GLib.shell_quote(script)} ${args.join(' ')}`);
        else
            _spawnArgv(['bash', script, ...args]);
    }

    _sudoSet(minutes) {
        const args = ['set', String(minutes)];
        if (this._settings.get_boolean('sudo-global-timestamp'))
            args.push('global');
        this._sudo(args);
    }

    _emptyTrash() {
        Gio.File.new_for_uri('trash:///').enumerate_children_async('standard::name',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
                let count = 0;
                try {
                    const en = file.enumerate_children_finish(res);
                    while (en.next_file(null))
                        count++;
                    en.close(null);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    console.error('[EaseHub] trash error:', e);
                }
                if (count === 0) {
                    _notify('The Trash is already empty');
                    return;
                }
                this._confirm(`Permanently delete ${count} item${count === 1 ? '' : 's'} in the Trash`, () => {
                    try {
                        const proc = Gio.Subprocess.new(['gio', 'trash', '--empty'], Gio.SubprocessFlags.NONE);
                        proc.wait_check_async(null, (p, r) => {
                            try {
                                p.wait_check_finish(r);
                                _notify('Trash emptied');
                            } catch {
                                _notify('Could not empty the Trash');
                            }
                        });
                    } catch (e) {
                        console.error('[EaseHub] empty trash error:', e);
                        _notify('Could not empty the Trash');
                    }
                });
            });
    }

    _clearRecent() {
        this._confirm('Clear the list of recently used files', () => {
            const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
            const bytes = new GLib.Bytes(new TextEncoder().encode(EMPTY_XBEL));
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE, this._cancellable, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                    _notify('Recent files list cleared');
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error('[EaseHub] clear recent error:', e);
                        _notify('Could not clear recent files');
                    }
                }
            });
        });
    }

    // Turns the Files (Nautilus) right-click actions on or off right away.
    _setFilesMenu(on) {
        this._settings.set_boolean('files-actions-enabled', on);
        try {
            const result = syncFilesMenu(this._settings, this._ext.path);
            _notify(result.ok ? (on ? `${result.message} (right-click in Files)` : 'Files right-click actions removed') : result.message);
        } catch (e) {
            console.error('[EaseHub] Files menu error:', e);
            _notify('Could not update the Files right-click menu');
        }
    }

    _clearClipboard(type, label) {
        try {
            St.Clipboard.get_default().set_text(type, '');
            _notify(`${label} cleared`);
        } catch (e) {
            console.error(`[EaseHub] ${label} clear error:`, e);
        }
    }

    _openScreenshot() {
        if (!Main.screenshotUI?.open) {
            _legacyScreenshot();
            return;
        }
        // Same sequence as GNOME's own screenshot button: drop the menu grab
        // first, then open the screenshot UI right before the next redraw.
        // GNOME 51 changed PopupMenu.close() to take a params object.
        this.menu.close(SHELL_MAJOR >= 51 ? { animate: false } : PopupAnimation.NONE);
        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            Main.screenshotUI.open().catch(e => {
                console.error('[EaseHub] screenshot UI error:', e);
                _legacyScreenshot();
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _openPrefs() {
        try {
            this._ext.openPreferences();
        } catch (e) {
            console.error('[EaseHub] open prefs error:', e);
            _notify('Could not open EaseHub Settings');
        }
    }

    _systemActions() {
        if (!this._actions)
            this._actions = SystemActions.getDefault();
        return this._actions;
    }

    _runSystemAction(label, fn) {
        try {
            this._systemActions().forceUpdate();
            fn();
        } catch (e) {
            console.error(`[EaseHub] ${label} error:`, e);
            _notify(`Could not ${label.toLowerCase()}`);
        }
    }

    _powerDefs() {
        const sa = () => this._systemActions();
        return [
            { id: 'lock', label: 'Lock Screen', icon: 'changes-prevent-symbolic',
                run: () => this._runSystemAction('Lock screen', () => sa().activateLockScreen()) },
            { id: 'logout', label: 'Log Out', icon: 'system-log-out-symbolic', confirm: 'Log out',
                run: () => this._runSystemAction('Log out', () => sa().activateLogout()) },
            { id: 'suspend', label: 'Suspend', icon: 'media-playback-pause-symbolic', confirm: 'Suspend',
                run: () => this._runSystemAction('Suspend', () => sa().activateSuspend()) },
            { id: 'reboot', label: 'Restart', icon: 'system-reboot-symbolic', confirm: 'Restart',
                run: () => this._runSystemAction('Restart', () => sa().activateRestart()) },
            { id: 'poweroff', label: 'Power Off', icon: 'system-shutdown-symbolic', confirm: 'Power off',
                run: () => this._runSystemAction('Power off', () => sa().activatePowerOff()) },
        ];
    }

    _runPower(def) {
        if (def.confirm)
            this._confirm(def.confirm, def.run);
        else
            def.run();
    }

    // ------------------------------------------------------------ menu

    _onMenuOpened() {
        this._syncToggles();
        this._syncVolume();
        this._refreshSudoLabel();
    }

    _refreshSudoLabel() {
        _sudoStateFile().load_contents_async(this._cancellable, (file, res) => {
            let text = '';
            try {
                const [, bytes] = file.load_contents_finish(res);
                text = new TextDecoder().decode(bytes).trim();
            } catch {}
            if (this._sudoLabel)
                this._sudoLabel.text = /^\d+$/.test(text) ? `Sudo Timeout (${text} min)` : 'Sudo Timeout';
        });
    }

    _iconButton(label, iconName, cb, styleClass = 'easehub-small-button', tooltip = label) {
        const b = new St.Button({
            style_class: `icon-button ${styleClass}`,
            child: new St.Icon({ gicon: _icon(iconName) }),
            accessible_name: label,
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        b.connect('clicked', cb);
        this._tooltips.add(b, tooltip);
        return b;
    }

    _buildMenu() {
        this._disconnectVolume();
        this.menu.removeAll();
        this._toggles = [];
        this._sudoLabel = null;
        this._layoutTiles = null;
        this._filesSwitch = null;

        const hidden = new Set(this._settings.get_strv('hidden-actions'));
        const shown = id => !hidden.has(id);
        const compact = this._settings.get_string('menu-layout') !== 'classic';
        const settings = this._settings;
        const separator = () => this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const item = (menu, label, iconNames, cb) => {
            const it = new PopupMenu.PopupImageMenuItem(label, _icon(...[].concat(iconNames)));
            it.connect('activate', cb);
            menu.addMenuItem(it);
            return it;
        };
        const rowItem = () => new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false, style_class: 'easehub-row' });

        // Power
        const power = this._powerDefs().filter(d => shown(d.id));
        if (power.length && compact) {
            const row = rowItem();
            const box = _box(false, { x_expand: true, style_class: 'easehub-button-row' });
            for (const def of power) {
                const asks = () => def.confirm && this._settings.get_boolean('confirm-dangerous');
                box.add_child(this._iconButton(def.label, def.icon, () => {
                    this.menu.close();
                    this._runPower(def);
                }, 'easehub-power-button', () => (asks() ? `${def.label}…` : def.label)));
            }
            row.add_child(box);
            this.menu.addMenuItem(row);
        } else if (power.length) {
            for (const def of power)
                item(this.menu, def.label, def.icon, () => this._runPower(def));
            separator();
        }

        // Volume: mute, down, slider, up
        if (shown('volume')) {
            const row = new PopupMenu.PopupBaseMenuItem({ activate: false, style_class: 'easehub-row easehub-volume-row' });
            const percent = () => `${Math.round((this._volume?.slider.value ?? 0) * 100)}%`;
            const mute = this._iconButton('Mute', 'audio-volume-high-symbolic', () => this._toggleMute(),
                'easehub-small-button', () => (this._volume?.stream?.is_muted ? 'Unmute' : 'Mute'));
            mute.x_expand = false;
            const down = this._iconButton('Volume down', 'list-remove-symbolic', () => this._stepVolume(-VOLUME_STEP),
                'easehub-small-button', () => `Volume down (${percent()})`);
            down.x_expand = false;
            const up = this._iconButton('Volume up', 'list-add-symbolic', () => this._stepVolume(VOLUME_STEP),
                'easehub-small-button', () => `Volume up (${percent()})`);
            up.x_expand = false;
            const slider = new Slider.Slider(0);
            slider.x_expand = true;
            slider.y_align = Clutter.ActorAlign.CENTER;
            slider.accessible_name = 'Volume';
            slider.track_hover = true;
            this._tooltips.add(slider, () => (this._volume?.stream ? `Volume: ${percent()}` : 'No sound output'));
            for (const w of [mute, down, slider, up])
                row.add_child(w);
            this.menu.addMenuItem(row);
            this._connectVolume(slider, mute);
        }

        // Quick toggles
        const toggles = this._toggleDefs().filter(d => shown(d.id));
        const setToggle = (def, on) => {
            try {
                def.set(on);
            } catch (e) {
                console.error(`[EaseHub] ${def.id} error:`, e);
                _notify(`Could not change ${def.label}`);
            }
        };
        if (toggles.length && compact) {
            const row = rowItem();
            const grid = _box(true, { x_expand: true, style_class: 'easehub-tile-grid' });
            row.add_child(grid);
            for (const def of toggles) {
                const content = _box(true, { x_align: Clutter.ActorAlign.CENTER });
                content.add_child(new St.Icon({ gicon: _icon(...def.icon), style_class: 'easehub-tile-icon', x_align: Clutter.ActorAlign.CENTER }));
                content.add_child(new St.Label({ text: def.short ?? def.label, style_class: 'easehub-tile-label', x_align: Clutter.ActorAlign.CENTER }));
                const b = new St.Button({
                    style_class: 'quick-toggle button easehub-tile',
                    toggle_mode: true,
                    can_focus: true,
                    x_expand: true,
                    child: content,
                    accessible_name: def.label,
                });
                b.connect('clicked', () => setToggle(def, b.checked));
                this._tooltips.add(b, () => `${def.label}: ${b.checked ? 'On' : 'Off'}`);
                this._toggles.push({ ...def, widget: b });
            }
            // Three tiles per row, counting only the available ones.
            this._layoutTiles = () => {
                const tiles = new Set(this._toggles.map(t => t.widget));
                for (const r of grid.get_children()) {
                    for (const c of r.get_children()) {
                        r.remove_child(c);
                        if (!tiles.has(c))
                            c.destroy();
                    }
                    r.destroy();
                }
                const visible = this._toggles.filter(t => t.widget.visible);
                for (let i = 0; i < visible.length; i += 3) {
                    const r = _box(false, { x_expand: true, style_class: 'easehub-tile-row' });
                    // Equal-width columns; empty spacers keep a short last row aligned.
                    r.layout_manager.homogeneous = true;
                    const slice = visible.slice(i, i + 3);
                    for (const t of slice)
                        r.add_child(t.widget);
                    for (let k = slice.length; k < 3; k++)
                        r.add_child(new St.Widget({ x_expand: true }));
                    grid.add_child(r);
                }
                row.visible = visible.length > 0;
            };
            this.menu.addMenuItem(row);
        } else if (toggles.length) {
            for (const def of toggles) {
                const it = new PopupMenu.PopupSwitchMenuItem(def.label, false);
                it.insert_child_at_index(new St.Icon({ gicon: _icon(...def.icon), style_class: 'popup-menu-icon' }), 0);
                it.connect('toggled', (_i, state) => setToggle(def, state));
                this._toggles.push({ ...def, widget: it });
                this.menu.addMenuItem(it);
            }
        }

        separator();

        // Groups
        const group = (label, iconName) => {
            const sub = new PopupMenu.PopupSubMenuMenuItem(label, true);
            sub.icon.gicon = _icon(iconName);
            return sub;
        };
        const addGroup = sub => {
            if (sub.menu.numMenuItems > 0)
                this.menu.addMenuItem(sub);
            else
                sub.destroy();
        };

        const apps = group('Apps & Files', 'folder-symbolic');
        if (shown('files'))
            item(apps.menu, 'Open Files', 'system-file-manager-symbolic', () => _openUri(`file://${GLib.get_home_dir()}`, 'your home folder'));
        if (shown('settings'))
            item(apps.menu, 'Settings', ['org.gnome.Settings-symbolic', 'emblem-system-symbolic'], () => _spawnArgv(['gnome-control-center']));
        if (shown('extensions') && _which('gnome-extensions-app'))
            item(apps.menu, 'Extensions', ['org.gnome.Extensions-symbolic', 'application-x-addon-symbolic'], () => _spawnArgv(['gnome-extensions-app']));
        if (shown('tweaks') && _which('gnome-tweaks'))
            item(apps.menu, 'Tweaks', ['org.gnome.tweaks-symbolic', 'preferences-other-symbolic'], () => _spawnArgv(['gnome-tweaks']));
        if (shown('open-terminal'))
            item(apps.menu, 'Terminal', 'utilities-terminal-symbolic', () => _runInTerminal(settings, 'Terminal'));
        if (shown('empty-trash'))
            item(apps.menu, 'Empty Trash…', 'user-trash-symbolic', () => this._emptyTrash());
        if (shown('clear-recent'))
            item(apps.menu, 'Clear Recent Files…', 'document-open-recent-symbolic', () => this._clearRecent());
        if (shown('files-menu')) {
            const it = new PopupMenu.PopupSwitchMenuItem('Files Right-Click Actions',
                settings.get_boolean('files-actions-enabled'));
            it.insert_child_at_index(new St.Icon({ gicon: _icon('document-properties-symbolic'), style_class: 'popup-menu-icon' }), 0);
            it.connect('toggled', (_i, on) => this._setFilesMenu(on));
            this._filesSwitch = it;
            apps.menu.addMenuItem(it);
        }
        addGroup(apps);

        const clip = group('Clipboard & Screenshot', 'edit-paste-symbolic');
        if (shown('screenshot'))
            item(clip.menu, 'Screenshot', 'camera-photo-symbolic', () => this._openScreenshot());
        if (shown('clipboard-clear'))
            item(clip.menu, 'Clear Clipboard', 'edit-clear-all-symbolic', () => this._clearClipboard(St.ClipboardType.CLIPBOARD, 'Clipboard'));
        if (shown('clipboard-clear-primary'))
            item(clip.menu, 'Clear Primary Selection', 'edit-clear-symbolic', () => this._clearClipboard(St.ClipboardType.PRIMARY, 'Primary selection'));
        addGroup(clip);

        const sys = group('Updates & System', 'software-update-available-symbolic');
        if (shown('apt-update'))
            item(sys.menu, 'Check for Updates', 'software-update-available-symbolic',
                () => _runInTerminal(settings, 'Checking for Updates', _checkUpdatesCommand()));
        if (shown('apt-upgrade'))
            item(sys.menu, 'Upgrade Packages…', 'system-software-update-symbolic',
                () => this._confirm('Upgrade system packages',
                    () => _runInTerminal(settings, 'Upgrading Packages', _upgradeCommand())));
        if (shown('flatpak-update') && _which('flatpak'))
            item(sys.menu, 'Update Flatpaks…', 'system-software-install-symbolic',
                () => this._confirm('Update Flatpaks',
                    () => _runInTerminal(settings, 'Updating Flatpaks', 'flatpak update -y')));
        if (shown('shell-reload') && !_isWayland())
            item(sys.menu, 'Reload GNOME Shell…', 'view-refresh-symbolic',
                () => this._confirm('Reload GNOME Shell', () => this._reloadShell()));
        addGroup(sys);

        if (shown('sudo-extend')) {
            const sub = group('Sudo Timeout', 'security-high-symbolic');
            this._sudoLabel = sub.label;
            const presets = [15, 30, 60, 120];
            const custom = settings.get_int('sudo-custom-minutes');
            item(sub.menu, 'Show Status', 'dialog-information-symbolic', () => this._sudo(['status']));
            for (const m of presets)
                item(sub.menu, m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`, 'alarm-symbolic', () => this._sudoSet(m));
            if (!presets.includes(custom))
                item(sub.menu, `${custom} minutes (custom)`, 'alarm-symbolic', () => this._sudoSet(custom));
            item(sub.menu, 'Forget Password Now', 'changes-prevent-symbolic', () => this._sudo(['forget'], false));
            item(sub.menu, 'Reset to System Default', 'edit-undo-symbolic', () => this._sudo(['reset']));
            this.menu.addMenuItem(sub);
        }

        // Footer: settings is always shown so the window can never become unreachable.
        separator();
        const footer = rowItem();
        const fbox = _box(false, { x_expand: true, style_class: 'easehub-button-row' });
        const close = cb => () => {
            this.menu.close();
            cb();
        };
        fbox.add_child(this._iconButton('EaseHub Settings', 'preferences-system-symbolic', close(() => this._openPrefs())));
        if (shown('about-readme'))
            fbox.add_child(this._iconButton('About and README', 'help-about-symbolic', close(() => _openUri(`${REPO_URL}#readme`, 'the README'))));
        if (shown('donate'))
            fbox.add_child(this._iconButton('Donate', 'emblem-favorite-symbolic', close(() => _openUri(DONATE_URL, 'the donation page')),
                'easehub-small-button', 'Donate (PayPal)'));
        footer.add_child(fbox);
        this.menu.addMenuItem(footer);

        this._syncToggles();
        this._refreshSudoLabel();
    }
});

export default class ComfortControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._migrateSettings();
        this._addIndicator();
        this._settingsIds = [
            this._settings.connect('changed::panel-position', () => this._addIndicator()),
            this._settings.connect('changed::panel-index', () => this._addIndicator()),
        ];
        Main.wm.addKeybinding('toggle-menu-shortcut', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._indicator?.menu.toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-menu-shortcut');
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _addIndicator() {
        this._indicator?.destroy();
        this._indicator = new EaseHubIndicator(this);
        Main.panel.addToStatusArea('easehub', this._indicator,
            this._settings.get_int('panel-index'), this._settings.get_string('panel-position'));
    }

    // 1.2 and earlier stored the visible items; 1.3 stores the hidden ones so
    // new items appear by default. Convert once, keeping the user's choices.
    _migrateSettings() {
        if (this._settings.get_user_value('enabled-actions') === null)
            return;
        const enabled = new Set(this._settings.get_strv('enabled-actions'));
        const hidden = new Set(this._settings.get_strv('hidden-actions'));
        for (const id of LEGACY_ACTIONS) {
            if (!enabled.has(id))
                hidden.add(id);
        }
        this._settings.set_strv('hidden-actions', [...hidden]);
        this._settings.reset('enabled-actions');
    }
}
