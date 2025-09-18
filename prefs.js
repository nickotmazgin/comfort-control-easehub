'use strict';

const { Adw, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
    // Left empty intentionally
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.easehub');
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: 'General' });

    const rowConfirm = new Adw.ActionRow({ title: 'Confirm dangerous actions' });
    const sw = new Gtk.Switch({
        active: settings.get_boolean('confirm-dangerous'),
        valign: Gtk.Align.CENTER,
    });

    rowConfirm.add_suffix(sw);
    rowConfirm.activatable_widget = sw;

    sw.connect('notify::active', () => {
        settings.set_boolean('confirm-dangerous', sw.active);
    });

    group.add(rowConfirm);
    page.add(group);
    window.add(page);
}

function buildPrefsWidget() {
    const window = new Adw.PreferencesWindow();
    fillPreferencesWindow(window);
    return window;
}
