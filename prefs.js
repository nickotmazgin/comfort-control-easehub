'use strict';

const { Adw, Gtk, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
    // Intentionally empty
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.easehub');
    const metadata = ExtensionUtils.getCurrentExtension().metadata || {};

    // General page
    const pageGeneral = new Adw.PreferencesPage({ title: 'General' });
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

    // Preferred terminal selector
    const rowTerminal = new Adw.ActionRow({ title: 'Preferred terminal (optional)' });
    const entry = new Gtk.Entry({ placeholder_text: 'kgx, gnome-terminal, tilix, x-terminal-emulator…' });
    try { entry.set_text(settings.get_string('preferred-terminal') || ''); } catch (_) {}
    entry.connect('changed', () => {
        settings.set_string('preferred-terminal', entry.get_text());
    });
    rowTerminal.add_suffix(entry);
    rowTerminal.activatable_widget = entry;
    groupGeneral.add(rowTerminal);

    pageGeneral.add(groupGeneral);

    // Actions page
    const pageActions = new Adw.PreferencesPage({ title: 'Actions' });
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
        ]},
        { title: 'Apps', ids: [
            ['settings', 'Open Settings'],
            ['extensions', 'Extensions'],
            ['tweaks', 'Tweaks'],
            ['open-terminal', 'Open Terminal'],
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
        { title: 'Links', ids: [
            ['about-readme', 'About & README…'],
            ['donate', 'Donate (PayPal)…'],
        ]},
    ];

    const current = () => new Set(settings.get_strv('enabled-actions'));
    const setList = (set) => settings.set_strv('enabled-actions', Array.from(set));

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

    // About page
    const pageAbout = new Adw.PreferencesPage({ title: 'About' });

    const groupInfo = new Adw.PreferencesGroup({ title: 'Extension' });
    groupInfo.add(new Adw.ActionRow({ title: 'Name', subtitle: metadata.name || 'EaseHub' }));
    groupInfo.add(new Adw.ActionRow({ title: 'Version', subtitle: metadata['version-name'] || String(metadata.version ?? '') }));
    groupInfo.add(new Adw.ActionRow({ title: 'Author', subtitle: 'Nick Otmazgin' }));
    groupInfo.add(new Adw.ActionRow({ title: 'Contact', subtitle: 'nickotmazgin.dev@gmail.com' }));
    pageAbout.add(groupInfo);

    const groupLinks = new Adw.PreferencesGroup({ title: 'Links' });

    const rowReadme = new Adw.ActionRow({ title: 'Open README' });
    rowReadme.activatable = true;
    rowReadme.connect('activated', () => {
        Gio.AppInfo.launch_default_for_uri('https://github.com/nickotmazgin/comfort-control-easehub#readme', null);
    });
    groupLinks.add(rowReadme);

    const rowDonate = new Adw.ActionRow({ title: 'Donate via PayPal' });
    rowDonate.activatable = true;
    rowDonate.connect('activated', () => {
        Gio.AppInfo.launch_default_for_uri('https://www.paypal.com/donate/?hosted_button_id=4HM44VH47LSMW', null);
    });
    groupLinks.add(rowDonate);

    const rowEmail = new Adw.ActionRow({ title: 'Email: nickotmazgin.dev@gmail.com' });
    rowEmail.activatable = true;
    rowEmail.connect('activated', () => {
        Gio.AppInfo.launch_default_for_uri('mailto:nickotmazgin.dev@gmail.com', null);
    });
    groupLinks.add(rowEmail);

    pageAbout.add(groupLinks);

    window.add(pageGeneral);
    window.add(pageActions);
    window.add(pageAbout);
}

function buildPrefsWidget() {
    const window = new Adw.PreferencesWindow();
    fillPreferencesWindow(window);
    return window;
}
