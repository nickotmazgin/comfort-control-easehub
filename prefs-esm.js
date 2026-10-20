// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) prefs — GNOME 45+ (ESM)
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const REPO_URL = 'https://github.com/nickotmazgin/comfort-control-easehub';

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

const ACTION_GROUPS = [
    { title: 'System', ids: [
        ['lock', 'Lock Screen'],
        ['logout', 'Log Out'],
        ['reboot', 'Reboot'],
        ['poweroff', 'Power Off'],
        ['suspend', 'Suspend'],
    ]},
    { title: 'Toggles', description: 'Shown as switches that reflect the current state', ids: [
        ['dnd', 'Do Not Disturb'],
        ['darkmode', 'Dark Mode'],
        ['night-light', 'Night Light'],
    ]},
    { title: 'Apps', ids: [
        ['settings', 'Open Settings'],
        ['extensions', 'Extensions'],
        ['tweaks', 'Tweaks'],
        ['open-terminal', 'Open Terminal'],
    ]},
    { title: 'Power Tools', ids: [
        ['shell-reload', 'Reload GNOME Shell', 'X11 sessions only; needs xdotool'],
        ['sudo-extend', 'Sudo Timeout submenu', 'Runs a visudo-validated helper in your terminal'],
    ]},
    { title: 'Utilities', ids: [
        ['clipboard-clear', 'Clear Clipboard'],
        ['clipboard-clear-primary', 'Clear Primary Selection'],
        ['screenshot', 'Screenshot'],
    ]},
    { title: 'Updates', description: 'APT, DNF, Zypper or Pacman — detected automatically', ids: [
        ['apt-update', 'Check System Updates'],
        ['apt-upgrade', 'Upgrade System Packages'],
        ['flatpak-update', 'Update Flatpaks'],
    ]},
    { title: 'Links', ids: [
        ['about-readme', 'About and README'],
        ['donate', 'Donate (PayPal)'],
    ]},
];

export default class EaseHubPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);
        window.search_enabled = true;

        window.add(this._buildGeneralPage(settings));
        window.add(this._buildActionsPage(settings));
        window.add(this._buildAboutPage());
    }

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' });

        const groupSafety = new Adw.PreferencesGroup({ title: 'Safety' });
        const rowConfirm = new Adw.SwitchRow({
            title: 'Confirm dangerous actions',
            subtitle: 'Ask before log out, reboot, power off, suspend, shell reload and upgrades',
        });
        settings.bind('confirm-dangerous', rowConfirm, 'active', Gio.SettingsBindFlags.DEFAULT);
        groupSafety.add(rowConfirm);
        page.add(groupSafety);

        const groupTerminal = new Adw.PreferencesGroup({
            title: 'Terminal',
            description: 'Used for updates, the sudo timeout helper and Open Terminal',
        });
        const rowTerminal = new Adw.ComboRow({
            title: 'Preferred terminal',
            model: Gtk.StringList.new(TERMINAL_CHOICES.map(([, label]) => label)),
        });
        const syncFromSettings = () => {
            const value = settings.get_string('preferred-terminal').trim();
            const idx = TERMINAL_CHOICES.findIndex(([v]) => v === value);
            rowTerminal.selected = idx >= 0 ? idx : 0;
            const missing = value && !GLib.find_program_in_path(value);
            rowTerminal.subtitle = missing ? `${value} is not installed — Auto will be used` : '';
        };
        syncFromSettings();
        rowTerminal.connect('notify::selected', () => {
            const choice = TERMINAL_CHOICES[rowTerminal.selected];
            if (choice && settings.get_string('preferred-terminal') !== choice[0])
                settings.set_string('preferred-terminal', choice[0]);
        });
        const changedId = settings.connect('changed::preferred-terminal', syncFromSettings);
        rowTerminal.connect('destroy', () => settings.disconnect(changedId));
        groupTerminal.add(rowTerminal);
        page.add(groupTerminal);

        return page;
    }

    _buildActionsPage(settings) {
        const page = new Adw.PreferencesPage({ title: 'Actions', icon_name: 'view-list-symbolic' });
        const current = () => new Set(settings.get_strv('enabled-actions'));
        const rows = new Map();

        for (const g of ACTION_GROUPS) {
            const grp = new Adw.PreferencesGroup({ title: g.title, description: g.description ?? '' });
            for (const [id, title, subtitle] of g.ids) {
                const row = new Adw.SwitchRow({ title, subtitle: subtitle ?? '', active: current().has(id), use_markup: false });
                row.connect('notify::active', () => {
                    const set = current();
                    if (row.active === set.has(id))
                        return;
                    if (row.active)
                        set.add(id);
                    else
                        set.delete(id);
                    settings.set_strv('enabled-actions', Array.from(set));
                });
                rows.set(id, row);
                grp.add(row);
            }
            page.add(grp);
        }

        // Keep switches in sync with resets and changes made elsewhere.
        const changedId = settings.connect('changed::enabled-actions', () => {
            const set = current();
            for (const [id, row] of rows)
                row.active = set.has(id);
        });
        page.connect('destroy', () => settings.disconnect(changedId));

        const groupReset = new Adw.PreferencesGroup();
        const resetButton = new Gtk.Button({
            label: 'Show All Actions',
            halign: Gtk.Align.CENTER,
            css_classes: ['pill'],
        });
        resetButton.connect('clicked', () => settings.reset('enabled-actions'));
        groupReset.add(resetButton);
        page.add(groupReset);

        return page;
    }

    _buildAboutPage() {
        const metadata = this.metadata || {};
        const page = new Adw.PreferencesPage({ title: 'About', icon_name: 'help-about-symbolic' });

        const groupInfo = new Adw.PreferencesGroup({ title: 'Extension' });
        // use_markup: false — Adw parses subtitles as Pango markup, so a bare
        // "&" would otherwise blank the whole row.
        const infoRow = (title, subtitle) => new Adw.ActionRow({ title, subtitle, use_markup: false });
        groupInfo.add(infoRow('Name', metadata.name || 'EaseHub'));
        groupInfo.add(infoRow('Version', metadata['version-name'] || String(metadata.version ?? '')));
        groupInfo.add(infoRow('Developer', 'Nick Otmazgin'));
        groupInfo.add(infoRow('Contact', 'nickotmazgin.dev@gmail.com'));
        groupInfo.add(infoRow('Description',
            'Panel menu for power, toggles, screenshots, updates & utilities. Wayland & X11/Xorg.'));
        page.add(groupInfo);

        const linkRow = (title, subtitle, uri) => {
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
        };

        const groupLinks = new Adw.PreferencesGroup({ title: 'Links' });
        groupLinks.add(linkRow('GitHub repository', '', REPO_URL));
        groupLinks.add(linkRow('README and documentation', '', `${REPO_URL}#readme`));
        groupLinks.add(linkRow('Changelog', '', `${REPO_URL}/blob/main/CHANGELOG.md`));
        groupLinks.add(linkRow('Credits and contributors', '', `${REPO_URL}/blob/main/CONTRIBUTORS.md`));
        groupLinks.add(linkRow('Report an issue', '', `${REPO_URL}/issues`));
        groupLinks.add(linkRow('Latest release', '', `${REPO_URL}/releases/latest`));
        groupLinks.add(linkRow('Donate via PayPal', '', 'https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW'));
        groupLinks.add(linkRow('Email: nickotmazgin.dev@gmail.com', '', 'mailto:nickotmazgin.dev@gmail.com'));
        page.add(groupLinks);

        const groupMore = new Adw.PreferencesGroup({ title: 'More by Nick Otmazgin' });
        groupMore.add(linkRow('ClipFlow Pro', 'Clipboard history manager for GNOME Shell',
            'https://github.com/nickotmazgin/clipflow-pro'));
        groupMore.add(linkRow('Numeric Clock', 'DD/MM/YYYY 24-hour top-bar clock',
            'https://github.com/nickotmazgin/Linux-Numeric-Date-And-Clock'));
        page.add(groupMore);

        return page;
    }
}
