// Comfort Control (EaseHub) prefs — GNOME 45+ (ESM)
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class EaseHubPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const metadata = this.metadata || {};

        const pageGeneral = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' });
        const groupGeneral = new Adw.PreferencesGroup({ title: 'Safety' });

        const rowConfirm = new Adw.ActionRow({ title: 'Confirm dangerous actions' });
        const swConfirm = new Gtk.Switch({
            active: settings.get_boolean('confirm-dangerous'),
            valign: Gtk.Align.CENTER,
        });
        rowConfirm.add_suffix(swConfirm);
        rowConfirm.activatable_widget = swConfirm;
        swConfirm.connect('notify::active', () => {
            settings.set_boolean('confirm-dangerous', swConfirm.active);
        });
        groupGeneral.add(rowConfirm);

        const choices = [
            { label: 'Auto (detect best)', value: '' },
            { label: 'GNOME Console (kgx)', value: 'kgx' },
            { label: 'GNOME Terminal', value: 'gnome-terminal' },
            { label: 'Kitty', value: 'kitty' },
            { label: 'Tilix', value: 'tilix' },
            { label: 'x-terminal-emulator', value: 'x-terminal-emulator' },
            { label: 'Custom…', value: '__custom__' },
        ];

        const groupTerminal = new Adw.PreferencesGroup({ title: 'Terminal' });
        const rowTerminal = new Adw.ActionRow({ title: 'Preferred terminal' });
        const dd = Gtk.DropDown.new_from_strings(choices.map(c => c.label));

        const rowCustom = new Adw.ActionRow({ title: 'Custom terminal command' });
        const entry = new Gtk.Entry({ placeholder_text: 'e.g., kitty, alacritty, foot, wezterm…' });
        rowCustom.add_suffix(entry);
        rowCustom.activatable_widget = entry;

        const findIndexByValue = v => {
            const idx = choices.findIndex(c => c.value === v);
            return idx >= 0 ? idx : choices.length - 1;
        };

        let currentPref = '';
        try { currentPref = settings.get_string('preferred-terminal') || ''; } catch {}
        const initIndex = findIndexByValue(currentPref);
        dd.set_selected(initIndex);
        if (initIndex === choices.length - 1) {
            entry.set_text(currentPref);
            rowCustom.set_visible(true);
        } else {
            rowCustom.set_visible(false);
        }

        const applySelection = () => {
            const idx = dd.get_selected();
            const sel = choices[idx];
            if (!sel)
                return;
            if (sel.value === '__custom__') {
                rowCustom.set_visible(true);
                settings.set_string('preferred-terminal', entry.get_text());
            } else {
                rowCustom.set_visible(false);
                settings.set_string('preferred-terminal', sel.value);
            }
        };

        dd.connect('notify::selected', applySelection);
        entry.connect('changed', () => {
            const idx = dd.get_selected();
            const sel = choices[idx];
            if (sel && sel.value === '__custom__')
                settings.set_string('preferred-terminal', entry.get_text());
        });

        rowTerminal.add_suffix(dd);
        rowTerminal.activatable_widget = dd;
        groupTerminal.add(rowTerminal);
        groupTerminal.add(rowCustom);
        pageGeneral.add(groupGeneral);
        pageGeneral.add(groupTerminal);

        const pageActions = new Adw.PreferencesPage({ title: 'Actions', icon_name: 'view-list-symbolic' });
        const groups = [
            { title: 'System', ids: [
                ['lock', 'Lock Screen'],
                ['logout', 'Log Out'],
                ['reboot', 'Reboot'],
                ['poweroff', 'Power Off'],
                ['suspend', 'Suspend'],
            ]},
            { title: 'Toggles', ids: [
                ['dnd', 'Do Not Disturb'],
                ['darkmode', 'Dark/Light Mode'],
                ['night-light', 'Night Light'],
            ]},
            { title: 'Apps', ids: [
                ['settings', 'Open Settings'],
                ['extensions', 'Extensions'],
                ['tweaks', 'Tweaks'],
                ['open-terminal', 'Open Terminal'],
            ]},
            { title: 'Power Tools', ids: [
                ['shell-reload', 'Reload GNOME Shell (X11 only)'],
                ['sudo-extend', 'Sudo Timeout submenu'],
            ]},
            { title: 'Utilities', ids: [
                ['clipboard-clear', 'Clear Clipboard'],
                ['clipboard-clear-primary', 'Clear Primary Selection'],
                ['screenshot', 'Screenshot'],
            ]},
            { title: 'Updates', ids: [
                ['apt-update', 'Check Updates (APT: update)'],
                ['apt-upgrade', 'Upgrade Packages (APT: upgrade)'],
                ['flatpak-update', 'Update Flatpaks'],
            ]},
        ];

        const current = () => new Set(settings.get_strv('enabled-actions'));
        const setList = set => settings.set_strv('enabled-actions', Array.from(set));

        for (const g of groups) {
            const grp = new Adw.PreferencesGroup({ title: g.title });
            for (const [id, label] of g.ids) {
                const row = new Adw.ActionRow({ title: label });
                const sw = new Gtk.Switch({
                    active: current().has(id),
                    valign: Gtk.Align.CENTER,
                });
                row.add_suffix(sw);
                row.activatable_widget = sw;
                sw.connect('notify::active', () => {
                    const set = current();
                    if (sw.active) set.add(id); else set.delete(id);
                    setList(set);
                });
                grp.add(row);
            }
            pageActions.add(grp);
        }

        const pageAbout = new Adw.PreferencesPage({ title: 'About', icon_name: 'help-about-symbolic' });
        const groupInfo = new Adw.PreferencesGroup({ title: 'Extension' });
        groupInfo.add(new Adw.ActionRow({ title: 'Name', subtitle: metadata.name || 'EaseHub' }));
        groupInfo.add(new Adw.ActionRow({ title: 'Version', subtitle: metadata['version-name'] || String(metadata.version ?? '') }));
        groupInfo.add(new Adw.ActionRow({ title: 'Developer', subtitle: 'Nick Otmazgin' }));
        groupInfo.add(new Adw.ActionRow({ title: 'Contact', subtitle: 'nickotmazgin.dev@gmail.com' }));
        groupInfo.add(new Adw.ActionRow({
            title: 'Description',
            subtitle: 'Panel menu for power actions, screenshots, updates, and everyday utilities.',
        }));
        pageAbout.add(groupInfo);

        const groupLinks = new Adw.PreferencesGroup({ title: 'Links' });
        const addLinkRow = (title, uri) => {
            const row = new Adw.ActionRow({ title });
            row.activatable = true;
            row.connect('activated', () => {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            });
            groupLinks.add(row);
        };
        addLinkRow('GitHub repository', 'https://github.com/nickotmazgin/comfort-control-easehub');
        addLinkRow('README and documentation', 'https://github.com/nickotmazgin/comfort-control-easehub#readme');
        addLinkRow('Credits and contributors', 'https://github.com/nickotmazgin/comfort-control-easehub/blob/main/CONTRIBUTORS.md');
        addLinkRow('Report an issue', 'https://github.com/nickotmazgin/comfort-control-easehub/issues');
        addLinkRow('Latest release', 'https://github.com/nickotmazgin/comfort-control-easehub/releases/latest');
        addLinkRow('Donate via PayPal', 'https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW');
        addLinkRow('Email: nickotmazgin.dev@gmail.com', 'mailto:nickotmazgin.dev@gmail.com');
        pageAbout.add(groupLinks);

        window.add(pageGeneral);
        window.add(pageActions);
        window.add(pageAbout);
    }
}
