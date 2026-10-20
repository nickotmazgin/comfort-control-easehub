// Test harness for tools/nested-smoke-test.sh — never shipped in the release zip.
// Drives the EaseHub panel menu inside an isolated nested GNOME Shell and logs
// "EHTEST" lines; spawned commands are captured instead of executed.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const L = (...a) => console.log('EHTEST', ...a);
const spawned = [];
const origNew = Gio.Subprocess.new;
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const label = it => it.label?.text ?? it.label?.get_text?.() ?? '';
const items = ind => ind.menu._getMenuItems();
const find = (ind, text) => items(ind).find(i => label(i) === text);

async function run() {
    const UUID = 'comfort-control@nickotmazgin';
    const ind = Main.panel.statusArea.easehub;
    L('indicator present', !!ind);
    for (const it of items(ind))
        L('item', it.constructor.name, JSON.stringify(label(it)), it._switch ? `state=${it._switch.state}` : '');

    // Switch toggle writes gsettings
    const notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const dnd = find(ind, 'Do Not Disturb');
    L('dnd before', dnd._switch.state, 'show-banners', notif.get_boolean('show-banners'));
    dnd.toggle();
    L('dnd after toggle', dnd._switch.state, 'show-banners', notif.get_boolean('show-banners'));
    // External change, then reopen menu -> switch should resync
    iface.set_string('color-scheme', 'prefer-dark');
    ind.menu.open(); await wait(300);
    L('dark switch after external prefer-dark + open', find(ind, 'Dark Mode')._switch.state);
    find(ind, 'Dark Mode').toggle();
    L('color-scheme after dark toggle off', iface.get_string('color-scheme'));
    ind.menu.close(); await wait(300);

    // Terminal commands: intercept spawns
    Gio.Subprocess.new = (argv, flags) => { spawned.push(argv); return null; };
    find(ind, 'Check System Updates').activate(null);
    const sudo = items(ind).find(i => i.menu && label(i) === 'Sudo Timeout');
    L('sudo submenu present', !!sudo);
    sudo.menu._getMenuItems().find(i => label(i) === 'Show Status').activate(null);
    find(ind, 'Open Terminal').activate(null);
    Gio.Subprocess.new = origNew;
    for (const a of spawned) L('spawn argv', JSON.stringify(a));

    // Screenshot UI
    ind.menu.open(); await wait(300);
    find(ind, 'Screenshot').activate(null);
    await wait(1500);
    L('screenshotUI visible', Main.screenshotUI.visible, 'menu open', ind.menu.isOpen);
    Main.screenshotUI.close(true); await wait(500);

    // Live rebuild on enabled-actions change
    const es = new Gio.Settings({settings_schema: Gio.SettingsSchemaSource.new_from_directory(
        Main.extensionManager.lookup(UUID).path + '/schemas', Gio.SettingsSchemaSource.get_default(), false).lookup('org.gnome.shell.extensions.easehub', false)});
    const n0 = items(ind).length;
    es.set_strv('enabled-actions', ['lock', 'dnd']);
    L('items full', n0, 'items after limiting to lock+dnd', items(ind).length, items(ind).map(label).filter(Boolean).join('|'));
    es.reset('enabled-actions');

    // Confirm dialog open then disable while open -> must not leak
    find(ind, 'Reboot').activate(null); await wait(500);
    L('dialog open', !!ind._dialog);
    Main.extensionManager.disableExtension(UUID); await wait(800);
    L('after disable indicator', !!Main.panel.statusArea.easehub, 'modal count', Main.modalCount);
    Main.extensionManager.enableExtension(UUID); await wait(800);
    L('after re-enable indicator', !!Main.panel.statusArea.easehub);
    L('DONE');
}

export default class T extends Extension {
    enable() {
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._id = 0;
            run().catch(e => L('FAIL', e, e.stack));
            return GLib.SOURCE_REMOVE;
        });
    }
    disable() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
    }
}
