// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) — GNOME 45+ (ESM)
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

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

const ALLOWED_TERMINALS = new Set([
    'gnome-terminal',
    'kgx',
    'tilix',
    'kitty',
    'konsole',
    'alacritty',
    'wezterm',
    'foot',
    'ptyxis',
    'x-terminal-emulator',
]);

function _resolveTerminal(settings) {
    try {
        const pref = (settings.get_string('preferred-terminal') || '').trim();
        if (pref && ALLOWED_TERMINALS.has(pref) && _which(pref))
            return pref;
    } catch {}
    if (_which('kgx')) return 'kgx';
    if (_which('gnome-terminal')) return 'gnome-terminal';
    if (_which('tilix')) return 'tilix';
    if (_which('kitty')) return 'kitty';
    if (_which('x-terminal-emulator')) return 'x-terminal-emulator';
    return '';
}

function _runCommandInTerminal(command, title, settings) {
    if (!command) {
        const term = _resolveTerminal(settings);
        if (term) { _spawn(term); return; }
        if (_which('kgx'))            { _spawn('kgx'); return; }
        if (_which('gnome-terminal')) { _spawn('gnome-terminal'); return; }
        _notify('Could not find a terminal to open.');
        return;
    }

    const holdOpenFragment = "; echo; echo 'Process finished. Press ENTER to close.'; read";
    const escapedCommand = command.replace(/'/g, "'\\''");
    const fullCommand = `'${escapedCommand}'${holdOpenFragment}`;

    const pref = _resolveTerminal(settings);
    if (pref) {
        if (pref === 'gnome-terminal') {
            _spawn(`gnome-terminal --title="${title}" -- bash -c ${fullCommand}`);
            return;
        }
        if (pref === 'kgx') {
            _spawn(`kgx --title="${title}" --hold -e bash -c '${escapedCommand}'`);
            return;
        }
        if (pref === 'tilix') {
            _spawn(`tilix -t "${title}" -e bash -c ${fullCommand}`);
            return;
        }
        if (pref === 'kitty') {
            _spawn(`kitty --title="${title}" bash -c ${fullCommand}`);
            return;
        }
        if (pref === 'x-terminal-emulator') {
            _spawn(`x-terminal-emulator -T "${title}" -e bash -c ${fullCommand}`);
            return;
        }
    }

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
    _init(settings, extensionPath, openPrefs) {
        super._init(0.0, 'EaseHub');
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._openPrefs = openPrefs;
        this.add_child(new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon easehub-icon' }));
        this._buildMenu();
        this._settingsChangedId = this._settings.connect('changed::enabled-actions', () => this._buildMenu());
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }

    _script(name) {
        return GLib.build_filenamev([this._extensionPath, 'scripts', name]);
    }

    _reloadShell() {
        if (Meta.is_wayland_compositor()) {
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
        _spawn(`bash ${GLib.shell_quote(script)}`);
    }

    _sudoTimeout(mode, settings) {
        const script = this._script('easehub-sudo-extend.sh');
        if (!GLib.file_test(script, GLib.FileTest.EXISTS)) {
            _notify('Sudo timeout script is missing from the extension install.');
            return;
        }
        _runCommandInTerminal(`bash ${GLib.shell_quote(script)} ${mode}`, 'Sudo Timeout', settings);
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
        add('Log Out', 'logout', () => _confirmIfNeeded('Log out', () => this._logout(), settings), 'system-log-out-symbolic');
        add('Reboot', 'reboot', () => _confirmIfNeeded('Reboot', () => this._reboot(), settings), 'system-reboot-symbolic');
        add('Power Off', 'poweroff', () => _confirmIfNeeded('Power off', () => this._powerOff(), settings), 'system-shutdown-symbolic');
        add('Suspend', 'suspend', () => this._suspend(), 'media-playback-pause-symbolic');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Do Not Disturb', 'dnd', () => this._toggleDND(), 'notifications-disabled-symbolic');
        add('Dark/Light Mode', 'darkmode', () => this._toggleDark(), 'weather-clear-night-symbolic');
        add('Night Light', 'night-light', () => this._toggleNightLight(), 'night-light-symbolic');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Open Settings', 'settings', () => _spawn('gnome-control-center'), 'emblem-system-symbolic');
        add('Extensions', 'extensions', () => _spawn('gnome-extensions-app'), 'application-x-addon-symbolic');
        add('Tweaks', 'tweaks', () => _spawn('gnome-tweaks'), 'emblem-system-symbolic');
        add('Open Terminal', 'open-terminal', () => _runCommandInTerminal(null, 'Terminal', settings), 'utilities-terminal-symbolic');

        if (enabled.has('shell-reload') && !Meta.is_wayland_compositor()) {
            add('Reload GNOME Shell (X11)', 'shell-reload',
                () => _confirmIfNeeded('Reload GNOME Shell', () => this._reloadShell(), settings),
                'view-refresh-symbolic');
        }

        if (enabled.has('sudo-extend')) {
            const sub = new PopupMenu.PopupSubMenuMenuItem('Sudo Timeout', true);
            sub.icon.icon_name = 'security-high-symbolic';
            const addSub = (label, mode) => {
                const it = new PopupMenu.PopupMenuItem(label);
                it.connect('activate', () => this._sudoTimeout(mode, settings));
                sub.menu.addMenuItem(it);
            };
            addSub('Show Status', 'status');
            addSub('15 minutes', 'set 15');
            addSub('30 minutes', 'set 30');
            addSub('60 minutes (1 hour)', 'set 60');
            addSub('120 minutes (2 hours)', 'set 120');
            addSub('180 minutes (3 hours)', 'set 180');
            addSub('Interactive Menu…', 'menu');
            addSub('Reset to System Default', 'reset');
            this.menu.addMenuItem(sub);
        }

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
            _confirmIfNeeded('Upgrade system packages', () => {
                let cmd = null;
                if (_which('apt'))         cmd = 'pkexec apt upgrade -y';
                else if (_which('dnf'))    cmd = 'pkexec dnf upgrade -y';
                else if (_which('zypper')) cmd = 'pkexec zypper update -y';
                else if (_which('pacman')) cmd = 'pkexec pacman -Syu --noconfirm';
                _runCommandInTerminal(cmd || 'echo "No supported package manager found."', 'Upgrading Packages...', settings);
            }, settings);
        }, 'system-software-update-symbolic');

        add('Update Flatpaks', 'flatpak-update', () => {
            _confirmIfNeeded('Update Flatpaks', () => {
                _runCommandInTerminal('flatpak update -y', 'Updating Flatpaks...', settings);
            }, settings);
        }, 'system-software-update-symbolic');

        add('About and README', 'about-readme', () => _openUrl('https://github.com/nickotmazgin/comfort-control-easehub#readme'), 'help-about-symbolic');
        add('Donate (PayPal)', 'donate', () => _openUrl('https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW'), 'emblem-favorite-symbolic');

        // Always visible (not toggleable) so the settings window can never
        // become unreachable from the panel.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefsItem = new PopupMenu.PopupMenuItem('EaseHub Settings…');
        prefsItem.insert_child_at_index(new St.Icon({
            icon_name: 'preferences-system-symbolic',
            style_class: 'popup-menu-icon',
        }), 0);
        prefsItem.connect('activate', () => {
            try {
                this._openPrefs();
            } catch (e) {
                console.error('[EaseHub] open prefs error:', e);
                _notify('Could not open EaseHub settings.');
            }
        });
        this.menu.addMenuItem(prefsItem);
    }

    _toggleNightLight() {
        try {
            const s = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
            const cur = s.get_boolean('night-light-enabled');
            s.set_boolean('night-light-enabled', !cur);
            _notify(`Night Light: ${!cur ? 'Enabled' : 'Disabled'}`);
        } catch (e) {
            console.error('[EaseHub] Night Light error:', e);
            _notify('Failed to toggle Night Light');
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
            _notify(`Failed to ${label.toLowerCase()}`);
        }
    }

    _lock() {
        this._runSystemAction('Lock screen', () => this._systemActions().activateLockScreen());
    }

    _logout() {
        this._runSystemAction('Log out', () => this._systemActions().activateLogout());
    }

    _reboot() {
        this._runSystemAction('Reboot', () => this._systemActions().activateRestart());
    }

    _powerOff() {
        this._runSystemAction('Power off', () => this._systemActions().activatePowerOff());
    }

    _suspend() {
        this._runSystemAction('Suspend', () => this._systemActions().activateSuspend());
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
        this._indicator = new EaseHubIndicator(this.getSettings(), this.path, () => this.openPreferences());
        Main.panel.addToStatusArea('easehub', this._indicator, 1, 'right');
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
