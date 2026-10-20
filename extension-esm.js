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
import { PopupAnimation } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import { PACKAGE_VERSION } from 'resource:///org/gnome/shell/misc/config.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const REPO_URL = 'https://github.com/nickotmazgin/comfort-control-easehub';
const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW';
const SHELL_MAJOR = parseInt(PACKAGE_VERSION, 10);

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
        _notify(`Failed to run: ${argv[0]}`);
        return false;
    }
}

function _openUrl(url) {
    try {
        Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (e) {
        console.error('[EaseHub] open URL error:', e);
        _notify('Failed to open URL');
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

// argv builders per terminal: (title, commandArgv) => full argv.
// Keep the keys in sync with ALLOWED_TERMINALS in prefs-esm.js.
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
        _notify(`Legacy screenshot tool is not installed. Run: ${cmd}`);
        return;
    }
    _notify('Using legacy screenshot tool (gnome-screenshot)');
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

// Quick toggles shown as switches whose state is read fresh on every menu open.
const TOGGLES = [
    {
        id: 'dnd', label: 'Do Not Disturb', icon: 'notifications-disabled-symbolic',
        schema: 'org.gnome.desktop.notifications',
        get: s => !s.get_boolean('show-banners'),
        set: (s, on) => s.set_boolean('show-banners', !on),
    },
    {
        id: 'darkmode', label: 'Dark Mode', icon: 'weather-clear-night-symbolic',
        schema: 'org.gnome.desktop.interface',
        get: s => s.get_string('color-scheme') === 'prefer-dark',
        // 'default' is what GNOME's own quick setting uses for light.
        set: (s, on) => s.set_string('color-scheme', on ? 'prefer-dark' : 'default'),
    },
    {
        id: 'night-light', label: 'Night Light', icon: 'night-light-symbolic',
        schema: 'org.gnome.settings-daemon.plugins.color',
        get: s => s.get_boolean('night-light-enabled'),
        set: (s, on) => s.set_boolean('night-light-enabled', on),
    },
];

const EaseHubIndicator = GObject.registerClass(
class EaseHubIndicator extends PanelMenu.Button {
    _init(settings, extensionPath, openPrefs) {
        super._init(0.0, 'EaseHub');
        this._settings = settings;
        this._extensionPath = extensionPath;
        this._openPrefs = openPrefs;
        this._toggleItems = [];
        this._dialog = null;
        this.add_child(new St.Icon({ icon_name: 'system-run-symbolic', style_class: 'system-status-icon easehub-icon' }));
        this._buildMenu();
        this._settingsChangedId = this._settings.connect('changed::enabled-actions', () => this._buildMenu());
        this._openStateId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._syncToggles();
        });
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._openStateId) {
            this.menu.disconnect(this._openStateId);
            this._openStateId = null;
        }
        this._dialog?.close();
        this._dialog = null;
        this._toggleItems = [];
        super.destroy();
    }

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
        return GLib.build_filenamev([this._extensionPath, 'scripts', name]);
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

    _sudoTimeout(mode) {
        const script = this._script('easehub-sudo-extend.sh');
        if (!GLib.file_test(script, GLib.FileTest.EXISTS)) {
            _notify('Sudo timeout script is missing from the extension install.');
            return;
        }
        _runInTerminal(this._settings, 'Sudo Timeout', `bash ${GLib.shell_quote(script)} ${mode}`);
    }

    _buildMenu() {
        this.menu.removeAll();
        this._toggleItems = [];
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
        const separator = () => this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        add('Lock Screen', 'lock', () => this._lock(), 'changes-prevent-symbolic');
        add('Log Out', 'logout', () => this._confirm('Log out', () => this._logout()), 'system-log-out-symbolic');
        add('Reboot', 'reboot', () => this._confirm('Reboot', () => this._reboot()), 'system-reboot-symbolic');
        add('Power Off', 'poweroff', () => this._confirm('Power off', () => this._powerOff()), 'system-shutdown-symbolic');
        add('Suspend', 'suspend', () => this._confirm('Suspend', () => this._suspend()), 'media-playback-pause-symbolic');

        separator();

        for (const toggle of TOGGLES) {
            if (!enabled.has(toggle.id))
                continue;
            const gsettings = _settingsFor(toggle.schema);
            if (!gsettings)
                continue;
            const it = new PopupMenu.PopupSwitchMenuItem(toggle.label, toggle.get(gsettings));
            it.insert_child_at_index(new St.Icon({ icon_name: toggle.icon, style_class: 'popup-menu-icon' }), 0);
            it.connect('toggled', (_item, state) => {
                try {
                    toggle.set(gsettings, state);
                } catch (e) {
                    console.error(`[EaseHub] ${toggle.label} error:`, e);
                    _notify(`Failed to toggle ${toggle.label}`);
                }
            });
            this._toggleItems.push({ item: it, toggle, gsettings });
            this.menu.addMenuItem(it);
        }

        separator();

        add('Open Settings', 'settings', () => _spawnArgv(['gnome-control-center']), 'emblem-system-symbolic');
        add('Extensions', 'extensions', () => _spawnArgv(['gnome-extensions-app']), 'application-x-addon-symbolic');
        add('Tweaks', 'tweaks', () => _spawnArgv(['gnome-tweaks']), 'org.gnome.tweaks-symbolic');
        add('Open Terminal', 'open-terminal', () => _runInTerminal(settings, 'Terminal'), 'utilities-terminal-symbolic');

        if (!_isWayland()) {
            add('Reload GNOME Shell (X11)', 'shell-reload',
                () => this._confirm('Reload GNOME Shell', () => this._reloadShell()),
                'view-refresh-symbolic');
        }

        if (enabled.has('sudo-extend')) {
            const sub = new PopupMenu.PopupSubMenuMenuItem('Sudo Timeout', true);
            sub.icon.icon_name = 'security-high-symbolic';
            const addSub = (label, mode) => {
                const it = new PopupMenu.PopupMenuItem(label);
                it.connect('activate', () => this._sudoTimeout(mode));
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

        separator();

        add('Clear Clipboard', 'clipboard-clear', () => this._clearClipboard(St.ClipboardType.CLIPBOARD, 'Clipboard'), 'edit-clear-all-symbolic');
        add('Clear Primary Selection', 'clipboard-clear-primary', () => this._clearClipboard(St.ClipboardType.PRIMARY, 'Primary selection'), 'edit-clear-symbolic');
        add('Screenshot', 'screenshot', () => this._openScreenshot(), 'camera-photo-symbolic');

        add('Check System Updates', 'apt-update',
            () => _runInTerminal(settings, 'Checking for Updates', _checkUpdatesCommand()),
            'software-update-available-symbolic');

        add('Upgrade System Packages', 'apt-upgrade',
            () => this._confirm('Upgrade system packages',
                () => _runInTerminal(settings, 'Upgrading Packages', _upgradeCommand())),
            'system-software-update-symbolic');

        add('Update Flatpaks', 'flatpak-update', () => {
            if (!_which('flatpak')) {
                _notify('Flatpak is not installed.');
                return;
            }
            this._confirm('Update Flatpaks',
                () => _runInTerminal(settings, 'Updating Flatpaks', 'flatpak update -y'));
        }, 'system-software-update-symbolic');

        add('About and README', 'about-readme', () => _openUrl(`${REPO_URL}#readme`), 'help-about-symbolic');
        add('Donate (PayPal)', 'donate', () => _openUrl(DONATE_URL), 'emblem-favorite-symbolic');

        // Always visible (not toggleable) so the settings window can never
        // become unreachable from the panel.
        separator();
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

    _syncToggles() {
        for (const { item, toggle, gsettings } of this._toggleItems) {
            try {
                item.setToggleState(toggle.get(gsettings));
            } catch (e) {
                console.error(`[EaseHub] ${toggle.label} sync error:`, e);
            }
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

    _clearClipboard(type, label) {
        try {
            St.Clipboard.get_default().set_text(type, '');
            _notify(`${label} cleared`);
        } catch (e) {
            console.error(`[EaseHub] ${label} clear error:`, e);
        }
    }
});

export default class ComfortControlExtension extends Extension {
    enable() {
        this._indicator = new EaseHubIndicator(this.getSettings(), this.path, () => this.openPreferences());
        Main.panel.addToStatusArea('easehub', this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
