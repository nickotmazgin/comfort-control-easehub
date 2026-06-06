// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) — GNOME 45+ (ESM)
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME = 'org.gnome.SessionManager';
const BUS_PATH = '/org/gnome/SessionManager';
const BUS_IFACE = 'org.gnome.SessionManager';

function _spawn(cmdline) {
    try {
        GLib.spawn_command_line_async(cmdline);
    } catch (e) {
        console.error('[EaseHub] spawn error:', e);
        Main.notify('EaseHub', `Failed to run: ${cmdline}`);
    }
}

function _notify(body) {
    Main.notify('EaseHub', body);
}

function _openUrl(url) {
    try {
        Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (e) {
        Main.notify('EaseHub', 'Failed to open URL');
    }
}

function _confirmIfNeeded(label, cb, settings) {
    if (!settings.get_boolean('confirm-dangerous')) {
        cb();
        return;
    }

    const d = new ModalDialog.ModalDialog({ styleClass: 'prompt-dialog' });
    d.contentLayout.add_child(new St.Label({ text: `${label}?`, x_align: Clutter.ActorAlign.CENTER }));
    d.addButton({ label: 'Cancel', action: () => d.close(), key: Clutter.KEY_Escape });
    d.addButton({ label: 'Proceed', action: () => { d.close(); cb(); }, default: true });
    d.open();
}

function _which(name) {
    try {
        return GLib.find_program_in_path(name) !== null;
    } catch {
        return false;
    }
}

function _runCommandInTerminal(command, title, settings) {
    if (!command) {
        try {
            const pref = (settings.get_string('preferred-terminal') || '').trim();
            if (pref && _which(pref)) { _spawn(pref); return; }
        } catch {}
        if (_which('kgx'))            { _spawn('kgx'); return; }
        if (_which('gnome-terminal')) { _spawn('gnome-terminal'); return; }
        _notify('Could not find a terminal to open.');
        return;
    }

    const holdOpenFragment = "; echo; echo 'Process finished. Press ENTER to close.'; read";
    const escapedCommand = command.replace(/'/g, "'\\''");
    const fullCommand = `'${escapedCommand}'${holdOpenFragment}`;

    try {
        const pref = (settings.get_string('preferred-terminal') || '').trim();
        if (pref) {
            if (pref === 'gnome-terminal' && _which('gnome-terminal')) {
                _spawn(`gnome-terminal --title="${title}" -- bash -c ${fullCommand}`);
                return;
            }
            if (pref === 'kgx' && _which('kgx')) {
                _spawn(`kgx --title="${title}" --hold -e bash -c '${escapedCommand}'`);
                return;
            }
            if (pref === 'tilix' && _which('tilix')) {
                _spawn(`tilix -t "${title}" -e bash -c ${fullCommand}`);
                return;
            }
            if (_which(pref)) {
                _spawn(`${pref} -e bash -c ${fullCommand}`);
                return;
            }
        }
    } catch {}

    if (_which('gnome-terminal')) {
        _spawn(`gnome-terminal --title="${title}" -- bash -c ${fullCommand}`);
        return;
    }
    if (_which('kgx')) {
        _spawn(`kgx --title="${title}" --hold -e bash -c '${escapedCommand}'`);
        return;
    }
    if (_which('kitty')) {
        _spawn(`kitty --title="${title}" bash -c ${fullCommand}`);
        return;
    }
    if (_which('tilix'))              { _spawn(`tilix -t "${title}" -e bash -c ${fullCommand}`); return; }
    if (_which('x-terminal-emulator')){ _spawn(`x-terminal-emulator -T "${title}" -e bash -c ${fullCommand}`); return; }

    _notify('Could not find a supported terminal to run the command.');
}

function _openScreenshot() {
    try {
        if (Main.screenshotUI?.openScreenshotUI) {
            Main.screenshotUI.openScreenshotUI();
            return;
        }
    } catch {}

    if (!_which('gnome-screenshot')) {
        let cmd = 'sudo apt install gnome-screenshot';
        if (_which('dnf'))    cmd = 'sudo dnf install gnome-screenshot';
        if (_which('zypper')) cmd = 'sudo zypper install gnome-screenshot';
        if (_which('pacman')) cmd = 'sudo pacman -S --needed gnome-screenshot';
        _notify(`Legacy screenshot tool is not installed. Run: ${cmd}`);
        return;
    }
    _notify('Using legacy screenshot tool (gnome-screenshot)');
    _spawn('gnome-screenshot -i');
}

const EaseHubIndicator = GObject.registerClass(
class EaseHubIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'EaseHub');
        this._settings = settings;
        this.add_child(new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'easehub-icon' }));
        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();
        const enabled = new Set(this._settings.get_strv('enabled-actions'));
        const settings = this._settings;

        const add = (label, id, cb, iconName) => {
            if (!enabled.has(id))
                return;
            const it = new PopupMenu.PopupMenuItem(label);
            if (iconName)
                it.insert_child_at_index(new St.Icon({ icon_name: iconName, style_class: 'popup-menu-icon' }), 0);
            it.connect('activate', cb);
            this.menu.addMenuItem(it);
        };

        add('Lock Screen', 'lock', () => this._lock(), 'changes-prevent-symbolic');
        add('Log Out', 'logout', () => _confirmIfNeeded('Log out', () => this._sessionCall('Logout', 1), settings), 'system-log-out-symbolic');
        add('Reboot', 'reboot', () => _confirmIfNeeded('Reboot', () => this._sessionCall('Reboot', true), settings), 'system-reboot-symbolic');
        add('Power Off', 'poweroff', () => _confirmIfNeeded('Power off', () => this._sessionCall('PowerOff', true), settings), 'system-shutdown-symbolic');
        add('Suspend', 'suspend', () => this._sessionCall('Suspend', true), 'media-playback-pause-symbolic');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Do Not Disturb', 'dnd', () => this._toggleDND(), 'notifications-disabled-symbolic');
        add('Dark/Light Mode', 'darkmode', () => this._toggleDark(), 'weather-clear-night-symbolic');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Open Settings', 'settings', () => _spawn('gnome-control-center'), 'emblem-system-symbolic');
        add('Extensions', 'extensions', () => _spawn('gnome-extensions-app'), 'application-x-addon-symbolic');
        add('Tweaks', 'tweaks', () => _spawn('gnome-tweaks'), 'emblem-system-symbolic');
        add('Open Terminal', 'open-terminal', () => _runCommandInTerminal(null, 'Terminal', settings), 'utilities-terminal-symbolic');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Clear Clipboard', 'clipboard-clear', () => this._clearClipboard(), 'edit-clear-all-symbolic');
        add('Clear Primary Selection', 'clipboard-clear-primary', () => this._clearPrimary(), 'edit-clear-symbolic');
        add('Screenshot', 'screenshot', () => _openScreenshot(), 'camera-photo-symbolic');

        add('Check System Updates', 'apt-update', () => {
            let cmd = null;
            if (_which('apt'))         cmd = 'pkexec apt update';
            else if (_which('dnf'))    cmd = 'pkexec dnf check-update';
            else if (_which('zypper')) cmd = 'pkexec zypper refresh';
            else if (_which('pacman')) cmd = 'pkexec pacman -Sy';
            _runCommandInTerminal(cmd || 'echo "No supported package manager found."', 'Checking for Updates...', settings);
        }, 'software-update-available-symbolic');

        add('Upgrade System Packages', 'apt-upgrade', () => {
            let cmd = null;
            if (_which('apt'))         cmd = 'pkexec apt upgrade -y';
            else if (_which('dnf'))    cmd = 'pkexec dnf upgrade -y';
            else if (_which('zypper')) cmd = 'pkexec zypper update -y';
            else if (_which('pacman')) cmd = 'pkexec pacman -Syu --noconfirm';
            _runCommandInTerminal(cmd || 'echo "No supported package manager found."', 'Upgrading Packages...', settings);
        }, 'system-software-update-symbolic');

        add('Update Flatpaks', 'flatpak-update', () => {
            _runCommandInTerminal('flatpak update -y', 'Updating Flatpaks...', settings);
        }, 'system-software-update-symbolic');

        add('About and README', 'about-readme', () => _openUrl('https://github.com/nickotmazgin/comfort-control-easehub#readme'), 'help-about-symbolic');
        add('Donate (PayPal)', 'donate', () => _openUrl('https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW'), 'emblem-favorite-symbolic');
    }

    _sessionCall(method, arg) {
        try {
            const proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                BUS_NAME,
                BUS_PATH,
                BUS_IFACE,
                null
            );
            if (arg === undefined)
                proxy.call_sync(method, null, Gio.DBusCallFlags.NONE, -1, null);
            else
                proxy.call_sync(method, new GLib.Variant('(b)', [arg === true]), Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            console.error('[EaseHub] Session call error:', e);
            _notify(`Failed to execute ${method}`);
        }
    }

    _lock() {
        try {
            const proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.gnome.ScreenSaver',
                '/org/gnome/ScreenSaver',
                'org.gnome.ScreenSaver',
                null
            );
            proxy.call_sync('Lock', null, Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            console.error('[EaseHub] Lock error:', e);
            _notify('Failed to lock screen');
        }
    }

    _toggleDND() {
        try {
            const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
            const show = s.get_boolean('show-banners');
            const newShow = !show;
            s.set_boolean('show-banners', newShow);
            _notify(`Do Not Disturb: ${newShow ? 'Disabled' : 'Enabled'}`);
        } catch (e) {
            console.error('[EaseHub] DND error:', e);
        }
    }

    _toggleDark() {
        try {
            const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            const cur = s.get_string('color-scheme');
            s.set_string('color-scheme', cur === 'prefer-dark' ? 'prefer-light' : 'prefer-dark');
        } catch (e) {
            console.error('[EaseHub] Dark mode toggle error:', e);
        }
    }

    _clearClipboard() {
        try {
            const clip = St.Clipboard.get_default();
            clip.set_text(St.ClipboardType.CLIPBOARD, '');
            _notify('Clipboard cleared');
        } catch (e) {
            console.error('[EaseHub] Clipboard clear error:', e);
        }
    }

    _clearPrimary() {
        try {
            const clip = St.Clipboard.get_default();
            clip.set_text(St.ClipboardType.PRIMARY, '');
            _notify('Primary selection cleared');
        } catch (e) {
            console.error('[EaseHub] Primary clear error:', e);
        }
    }
});

export default class ComfortControlExtension extends Extension {
    enable() {
        this._indicator = new EaseHubIndicator(this.getSettings());
        Main.panel.addToStatusArea('easehub', this._indicator, 1, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
