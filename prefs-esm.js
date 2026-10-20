// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) prefs — GNOME 45+ (ESM)
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { FILES_ACTIONS, FILES_GROUPS, cleanName, scriptsDir, syncFilesMenu } from './lib/filesMenu.js';

const REPO_URL = 'https://github.com/nickotmazgin/comfort-control-easehub';
const DONATE_URL = 'https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW';

// Keep in sync with TERMINALS in extension-esm.js; the extension ignores
// anything else stored in 'preferred-terminal'.
const TERMINAL_CHOICES = [
    ['', 'Auto (detect best)'],
    ['ptyxis', 'Ptyxis'],
    ['kgx', 'GNOME Console (kgx)'],
    ['gnome-terminal', 'GNOME Terminal'],
    ['konsole', 'Konsole'],
    ['tilix', 'Tilix'],
    ['kitty', 'Kitty'],
    ['alacritty', 'Alacritty'],
    ['wezterm', 'WezTerm'],
    ['foot', 'foot'],
    ['x-terminal-emulator', 'x-terminal-emulator (Debian default)'],
];

const ICON_CHOICES = [
    ['easehub', 'EaseHub'],
    ['system-run-symbolic', 'Gears'],
    ['emblem-system-symbolic', 'Cog'],
    ['view-app-grid-symbolic', 'Grid'],
    ['preferences-other-symbolic', 'Tools'],
    ['starred-symbolic', 'Star'],
];

const MENU_GROUPS = [
    { title: 'Power', description: 'A row of buttons in the compact layout', ids: [
        ['lock', 'Lock Screen'],
        ['logout', 'Log Out', 'Asks first'],
        ['suspend', 'Suspend', 'Asks first'],
        ['reboot', 'Restart', 'Asks first'],
        ['poweroff', 'Power Off', 'Asks first'],
    ]},
    { title: 'Sound', ids: [
        ['volume', 'Volume', 'Mute, down, slider and up'],
    ]},
    { title: 'Quick Toggles', description: 'Tiles that show the current state; hidden automatically when the hardware is missing', ids: [
        ['wifi', 'Wi-Fi'],
        ['bluetooth', 'Bluetooth'],
        ['airplane', 'Airplane Mode'],
        ['dnd', 'Do Not Disturb'],
        ['darkmode', 'Dark Mode'],
        ['night-light', 'Night Light'],
        ['keep-awake', 'Keep Awake', 'Stops the screen from blanking and the computer from sleeping while on'],
    ]},
    { title: 'Apps & Files', ids: [
        ['files', 'Open Files', 'Your home folder in the file manager'],
        ['settings', 'Settings'],
        ['extensions', 'Extensions'],
        ['tweaks', 'Tweaks', 'Shown only when GNOME Tweaks is installed'],
        ['open-terminal', 'Terminal'],
        ['empty-trash', 'Empty Trash', 'Shows how many items will be deleted and asks first'],
        ['clear-recent', 'Clear Recent Files', 'Wipes the "Recent" list in Files and apps; asks first'],
        ['files-menu', 'Files Right-Click Actions switch', 'Turn the Files right-click menu on or off from the panel'],
    ]},
    { title: 'Clipboard & Screenshot', ids: [
        ['screenshot', 'Screenshot'],
        ['clipboard-clear', 'Clear Clipboard'],
        ['clipboard-clear-primary', 'Clear Primary Selection'],
    ]},
    { title: 'Updates & System', description: 'APT, DNF, Zypper or Pacman — detected automatically', ids: [
        ['apt-update', 'Check for Updates'],
        ['apt-upgrade', 'Upgrade Packages'],
        ['flatpak-update', 'Update Flatpaks', 'Shown only when Flatpak is installed'],
        ['shell-reload', 'Reload GNOME Shell', 'X11 sessions only; needs xdotool'],
    ]},
    { title: 'Footer', description: 'EaseHub Settings is always shown', ids: [
        ['appearance', 'Appearance button', 'Cycles the menu between System, Light and Dark'],
        ['about-readme', 'About and README'],
        ['donate', 'Donate'],
    ]},
];

const FILES_KEYS = ['files-menu-name', 'files-layout', 'files-hidden-actions', 'files-titles', 'files-notify', 'files-editor'];
const EDITOR_CHOICES = [
    ['', 'Auto (Cursor, VS Code, Text Editor, gedit, Kate)'],
    ['cursor', 'Cursor'],
    ['code', 'Visual Studio Code'],
    ['gnome-text-editor', 'GNOME Text Editor'],
    ['gedit', 'gedit'],
    ['kate', 'Kate'],
];
// ---------------------------------------------------------------- helpers

function comboRow(settings, key, title, choices, subtitle = '') {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const sync = () => {
        const idx = choices.findIndex(([v]) => v === settings.get_string(key));
        row.selected = idx >= 0 ? idx : 0;
    };
    sync();
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value !== undefined && settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({ title, subtitle, use_markup: false });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1, page_increment: 10 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// On/off rows backed by a "hidden ids" string array.
function hiddenListRows(settings, key, group, items) {
    const rows = new Map();
    const current = () => new Set(settings.get_strv(key));
    for (const [id, title, subtitle] of items) {
        const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? '', active: !current().has(id), use_markup: false });
        row.connect('notify::active', () => {
            const set = current();
            if (row.active !== set.has(id))
                return;
            if (row.active)
                set.delete(id);
            else
                set.add(id);
            settings.set_strv(key, [...set]);
        });
        rows.set(id, row);
        group.add(row);
    }
    const changedId = settings.connect(`changed::${key}`, () => {
        const set = current();
        for (const [id, row] of rows)
            row.active = !set.has(id);
    });
    group.connect('destroy', () => settings.disconnect(changedId));
}

function confirmDialog(parent, heading, body, actionLabel, onConfirm) {
    const d = new Adw.MessageDialog({ transient_for: parent, modal: true, heading, body });
    d.add_response('cancel', 'Cancel');
    d.add_response('ok', actionLabel);
    d.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
    d.set_default_response('cancel');
    d.set_close_response('cancel');
    d.connect('response', (_d, response) => {
        if (response === 'ok')
            onConfirm();
    });
    d.present();
}

function linkRow(title, subtitle, uri) {
    const row = new Adw.ActionRow({ title, subtitle, activatable: true, use_markup: false });
    row.add_suffix(new Gtk.Image({ icon_name: 'adw-external-link-symbolic' }));
    row.connect('activated', () => {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e) {
            console.error('[EaseHub] open link error:', e);
        }
    });
    return row;
}

// ---------------------------------------------------------------- window

export default class EaseHubPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._window = window;
        window.set_default_size(680, 760);
        window.search_enabled = true;

        window.add(this._generalPage(settings));
        window.add(this._menuPage(settings));
        window.add(this._filesPage(settings));
        window.add(this._aboutPage());

        // Reopen on the page used last time.
        const last = settings.get_string('prefs-page');
        if (['general', 'menu', 'files', 'about'].includes(last))
            window.visible_page_name = last;
        window.connect('notify::visible-page-name', () => {
            if (window.visible_page_name)
                settings.set_string('prefs-page', window.visible_page_name);
        });
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({ title, timeout: 3 }));
    }

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({ name: 'general', title: 'General', icon_name: 'preferences-system-symbolic' });

        const panel = new Adw.PreferencesGroup({ title: 'Panel' });
        panel.add(comboRow(settings, 'menu-layout', 'Menu layout',
            [['compact', 'Compact'], ['classic', 'Classic']],
            'Compact: button rows and toggle tiles. Classic: one row per item'));

        panel.add(comboRow(settings, 'menu-style', 'Appearance',
            [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']],
            'System follows your shell theme; Light and Dark always use those colors'));

        const iconRow = comboRow(settings, 'panel-icon', 'Panel icon', ICON_CHOICES);
        const preview = new Gtk.Image({ pixel_size: 16 });
        const syncPreview = () => {
            const name = settings.get_string('panel-icon');
            if (!name || name === 'easehub')
                // As a GIcon so GTK recolors the symbolic icon for light and dark themes.
                preview.set_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(
                    GLib.build_filenamev([this.path, 'icons', 'easehub-symbolic.svg']))));
            else
                preview.icon_name = name;
        };
        syncPreview();
        const iconId = settings.connect('changed::panel-icon', syncPreview);
        iconRow.connect('destroy', () => settings.disconnect(iconId));
        iconRow.add_prefix(preview);
        panel.add(iconRow);

        panel.add(comboRow(settings, 'panel-position', 'Position in the top bar',
            [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]));
        panel.add(spinRow(settings, 'panel-index', 'Order in that area', '0 is first; higher numbers move it further along', 0, 20));
        panel.add(this._shortcutRow(settings));
        page.add(panel);

        const safety = new Adw.PreferencesGroup({ title: 'Safety' });
        safety.add(switchRow(settings, 'confirm-dangerous', 'Confirm risky actions',
            'Ask before log out, restart, power off, suspend, shell reload, upgrades, emptying the Trash and clearing recent files'));
        page.add(safety);

        const terminal = new Adw.PreferencesGroup({
            title: 'Terminal',
            description: 'Used for updates, the sudo timeout helper, Open Terminal, and Open Terminal Here in Files',
        });
        const termRow = comboRow(settings, 'preferred-terminal', 'Preferred terminal', TERMINAL_CHOICES);
        const syncTerm = () => {
            const value = settings.get_string('preferred-terminal').trim();
            termRow.subtitle = value && !GLib.find_program_in_path(value) ? `${value} is not installed — Auto will be used` : '';
        };
        syncTerm();
        const termId = settings.connect('changed::preferred-terminal', syncTerm);
        termRow.connect('destroy', () => settings.disconnect(termId));
        terminal.add(termRow);
        page.add(terminal);

        const reset = new Adw.PreferencesGroup({ title: 'Restore Defaults' });
        const resetRow = new Adw.ActionRow({
            title: 'Reset all settings',
            subtitle: 'Every EaseHub setting goes back to its default, and the Files right-click menu is turned off',
        });
        const resetButton = new Gtk.Button({ label: 'Reset…', valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
        resetButton.connect('clicked', () => confirmDialog(this._window, 'Reset all EaseHub settings?',
            'This cannot be undone. Your sudo timeout and other system settings are not changed.', 'Reset', () => {
                for (const key of settings.settings_schema.list_keys())
                    settings.reset(key);
                this._toast('All settings reset to defaults');
            }));
        resetRow.add_suffix(resetButton);
        reset.add(resetRow);
        page.add(reset);

        return page;
    }

    _shortcutRow(settings) {
        const row = new Adw.ActionRow({ title: 'Keyboard shortcut', subtitle: 'Opens the EaseHub menu' });
        const label = new Gtk.ShortcutLabel({ disabled_text: 'None', valign: Gtk.Align.CENTER });
        const sync = () => {
            label.accelerator = settings.get_strv('toggle-menu-shortcut')[0] ?? '';
        };
        sync();
        const id = settings.connect('changed::toggle-menu-shortcut', sync);
        row.connect('destroy', () => settings.disconnect(id));
        const setButton = new Gtk.Button({ label: 'Set…', valign: Gtk.Align.CENTER });
        setButton.connect('clicked', () => this._captureShortcut(settings));
        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Remove shortcut', css_classes: ['flat'],
        });
        clearButton.connect('clicked', () => settings.set_strv('toggle-menu-shortcut', []));
        row.add_suffix(label);
        row.add_suffix(setButton);
        row.add_suffix(clearButton);
        return row;
    }

    _captureShortcut(settings) {
        const dialog = new Adw.MessageDialog({
            transient_for: this._window,
            modal: true,
            heading: 'Set Shortcut',
            body: 'Press the new shortcut, including Ctrl, Alt or Super. Esc cancels; Backspace removes it.',
        });
        dialog.add_response('cancel', 'Cancel');
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && !mods) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (keyval === Gdk.KEY_BackSpace && !mods) {
                settings.set_strv('toggle-menu-shortcut', []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            const needed = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;
            if (!(mods & needed) || !Gtk.accelerator_valid(keyval, mods))
                return Gdk.EVENT_STOP;
            const accel = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mods);
            if (accel) {
                settings.set_strv('toggle-menu-shortcut', [accel]);
                dialog.close();
            }
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }

    _menuPage(settings) {
        const page = new Adw.PreferencesPage({ name: 'menu', title: 'Menu', icon_name: 'view-list-symbolic' });
        for (const g of MENU_GROUPS) {
            const grp = new Adw.PreferencesGroup({ title: g.title, description: g.description ?? '' });
            hiddenListRows(settings, 'hidden-actions', grp, g.ids);
            page.add(grp);
        }

        const sudo = new Adw.PreferencesGroup({
            title: 'Sudo Timeout',
            description: 'Every change is checked with visudo before it is installed, and rolled back if anything fails',
        });
        hiddenListRows(settings, 'hidden-actions', sudo, [['sudo-extend', 'Show the Sudo Timeout menu']]);
        sudo.add(spinRow(settings, 'sudo-custom-minutes', 'Custom minutes',
            'Adds this value to the menu next to 15, 30, 60 and 120 minutes', 1, 1440));
        sudo.add(switchRow(settings, 'sudo-global-timestamp', 'Share one login across all terminals',
            'Off: each terminal asks once (safer, the sudo default). On: one login covers every terminal until the timeout ends'));
        page.add(sudo);

        const tail = new Adw.PreferencesGroup();
        const showAll = new Gtk.Button({ label: 'Show All Items', halign: Gtk.Align.CENTER, css_classes: ['pill'] });
        showAll.connect('clicked', () => settings.reset('hidden-actions'));
        tail.add(showAll);
        page.add(tail);
        return page;
    }

    _filesPage(settings) {
        const page = new Adw.PreferencesPage({ name: 'files', title: 'Files', icon_name: 'system-file-manager-symbolic' });

        let pending = 0;
        const resync = (announce = true) => {
            if (pending)
                GLib.source_remove(pending);
            pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                pending = 0;
                try {
                    const result = syncFilesMenu(settings, this.path);
                    if (announce || !result.ok)
                        this._toast(result.message);
                } catch (e) {
                    console.error('[EaseHub] Files menu error:', e);
                    this._toast(`Could not update the Files menu: ${e.message}`);
                }
                return GLib.SOURCE_REMOVE;
            });
        };
        const ids = ['files-actions-enabled', 'files-menu-name', 'files-layout', 'files-hidden-actions', 'files-titles']
            .map(k => settings.connect(`changed::${k}`, () => resync()));
        page.connect('destroy', () => {
            ids.forEach(id => settings.disconnect(id));
            if (pending)
                GLib.source_remove(pending);
        });

        const main = new Adw.PreferencesGroup({
            title: 'Right-Click Menu in Files',
            description: 'Adds actions under Scripts ▸ EaseHub when you right-click files or folders in Files (Nautilus)',
        });
        main.add(switchRow(settings, 'files-actions-enabled', 'Add EaseHub actions to Files',
            'Off by default. Turning it off removes everything EaseHub added'));

        const nameRow = new Adw.EntryRow({ title: 'Menu name', show_apply_button: true, text: settings.get_string('files-menu-name') });
        nameRow.connect('apply', () => {
            const name = cleanName(nameRow.text);
            if (!name) {
                this._toast('The menu name cannot be empty');
                nameRow.text = settings.get_string('files-menu-name');
                return;
            }
            settings.set_string('files-menu-name', name);
        });
        const nameId = settings.connect('changed::files-menu-name', () => {
            nameRow.text = settings.get_string('files-menu-name');
        });
        nameRow.connect('destroy', () => settings.disconnect(nameId));
        main.add(nameRow);
        main.add(comboRow(settings, 'files-layout', 'Layout',
            [['grouped', 'Grouped'], ['flat', 'Flat']], 'Grouped: Copy ▸, Open ▸ and Tools ▸ submenus. Flat: one list'));
        main.add(switchRow(settings, 'files-notify', 'Show notifications', 'A short confirmation after each action'));
        main.add(comboRow(settings, 'files-editor', 'Editor for "Open in Editor"', EDITOR_CHOICES));

        const where = new Adw.ActionRow({ title: 'Open the Files scripts folder', activatable: true });
        where.add_suffix(new Gtk.Image({ icon_name: 'folder-open-symbolic' }));
        where.connect('activated', () => {
            const dir = scriptsDir();
            try {
                dir.make_directory_with_parents(null);
            } catch {}
            Gio.AppInfo.launch_default_for_uri(dir.get_uri(), null);
        });
        main.add(where);
        page.add(main);

        const titles = () => settings.get_value('files-titles').deep_unpack();
        const actionRows = [];
        for (const [group, groupTitle] of Object.entries(FILES_GROUPS)) {
            const grp = new Adw.PreferencesGroup({
                title: groupTitle,
                description: group === 'copy' ? 'Type a new name and press Enter or ✓. Clear it to restore the default. The switch shows or hides the action.' : '',
            });
            for (const [id, defaultTitle, g] of FILES_ACTIONS) {
                if (g !== group)
                    continue;
                const row = new Adw.EntryRow({ title: defaultTitle, show_apply_button: true, text: titles()[id] ?? '' });
                row.connect('apply', () => {
                    const t = titles();
                    const value = cleanName(row.text);
                    if (value && value !== defaultTitle)
                        t[id] = value;
                    else
                        delete t[id];
                    settings.set_value('files-titles', new GLib.Variant('a{ss}', t));
                    row.text = t[id] ?? '';
                });
                const sw = new Gtk.Switch({ valign: Gtk.Align.CENTER, tooltip_text: 'Show this action' });
                sw.connect('notify::active', () => {
                    const hidden = new Set(settings.get_strv('files-hidden-actions'));
                    if (sw.active === !hidden.has(id))
                        return;
                    if (sw.active)
                        hidden.delete(id);
                    else
                        hidden.add(id);
                    settings.set_strv('files-hidden-actions', [...hidden]);
                });
                row.add_suffix(sw);
                grp.add(row);
                actionRows.push({ id, row, sw });
            }
            page.add(grp);
        }
        const syncActions = () => {
            const hidden = new Set(settings.get_strv('files-hidden-actions'));
            const t = titles();
            for (const { id, row, sw } of actionRows) {
                sw.active = !hidden.has(id);
                row.text = t[id] ?? '';
            }
        };
        syncActions();
        const actionIds = ['files-hidden-actions', 'files-titles'].map(k => settings.connect(`changed::${k}`, syncActions));
        page.connect('destroy', () => actionIds.forEach(id => settings.disconnect(id)));

        const tail = new Adw.PreferencesGroup();
        const resetFiles = new Gtk.Button({ label: 'Restore Default Names and Actions', halign: Gtk.Align.CENTER, css_classes: ['pill'] });
        resetFiles.connect('clicked', () => {
            for (const key of FILES_KEYS)
                settings.reset(key);
            this._toast('Files menu restored to defaults');
        });
        tail.add(resetFiles);
        page.add(tail);

        // Repair launchers silently after an update or a manual change.
        if (settings.get_boolean('files-actions-enabled'))
            resync(false);
        return page;
    }

    _aboutPage() {
        const metadata = this.metadata || {};
        const page = new Adw.PreferencesPage({ name: 'about', title: 'About', icon_name: 'help-about-symbolic' });

        const info = new Adw.PreferencesGroup({ title: 'Extension' });
        // use_markup: false — Adw parses subtitles as Pango markup, so a bare
        // "&" would otherwise blank the whole row.
        const infoRow = (title, subtitle) => new Adw.ActionRow({ title, subtitle, use_markup: false });
        info.add(infoRow('Name', metadata.name || 'EaseHub'));
        info.add(infoRow('Version', metadata['version-name'] || String(metadata.version ?? '')));
        info.add(infoRow('Developer', 'Nick Otmazgin'));
        info.add(infoRow('Contact', 'nickotmazgin.dev@gmail.com'));
        info.add(infoRow('Description',
            'Panel menu for power, sound, quick toggles, files, screenshots, updates & sudo timeout. Wayland & X11/Xorg.'));
        page.add(info);

        const links = new Adw.PreferencesGroup({ title: 'Links' });
        links.add(linkRow('GitHub repository', '', REPO_URL));
        links.add(linkRow('README and documentation', '', `${REPO_URL}#readme`));
        links.add(linkRow('Changelog', '', `${REPO_URL}/blob/main/CHANGELOG.md`));
        links.add(linkRow('Credits and contributors', '', `${REPO_URL}/blob/main/CONTRIBUTORS.md`));
        links.add(linkRow('Report an issue', '', `${REPO_URL}/issues`));
        links.add(linkRow('Latest release', '', `${REPO_URL}/releases/latest`));
        links.add(linkRow('Donate via PayPal', '', DONATE_URL));
        links.add(linkRow('Email: nickotmazgin.dev@gmail.com', '', 'mailto:nickotmazgin.dev@gmail.com'));
        page.add(links);

        const more = new Adw.PreferencesGroup({ title: 'More by Nick Otmazgin' });
        more.add(linkRow('ClipFlow Pro', 'Clipboard history manager for GNOME Shell', 'https://github.com/nickotmazgin/clipflow-pro'));
        more.add(linkRow('Numeric Clock', 'DD/MM/YYYY 24-hour top-bar clock', 'https://github.com/nickotmazgin/Linux-Numeric-Date-And-Clock'));
        more.add(linkRow('FluentVoice Pro', 'System-wide text-to-speech for Windows 11 and 10', 'https://github.com/nickotmazgin/fluentvoice-pro'));
        page.add(more);
        return page;
    }
}
