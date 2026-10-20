// Test harness for tools/nested-smoke-test.sh — never shipped in the release zip.
// Drives the EaseHub panel menu inside an isolated nested GNOME Shell and logs
// "EHTEST" lines; spawned commands are captured instead of executed.
//
// Wi-Fi, Bluetooth, Airplane Mode and volume talk to system services outside
// the isolated session, so they are only inspected here, never changed.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'comfort-control@nickotmazgin';
const L = (...a) => console.log('EHTEST', ...a);
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
const label = it => it.label?.text ?? '';
const items = ind => ind.menu._getMenuItems();
const findItem = (menu, text) => menu._getMenuItems().find(i => label(i) === text);
const buttons = actor => {
    const out = [];
    const walk = a => {
        if (a instanceof St.Button)
            out.push(a);
        for (const c of a.get_children?.() ?? [])
            walk(c);
    };
    walk(actor);
    return out;
};

function easehubSettings() {
    const ext = Main.extensionManager.lookup(UUID);
    const src = Gio.SettingsSchemaSource.new_from_directory(`${ext.path}/schemas`,
        Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({ settings_schema: src.lookup('org.gnome.shell.extensions.easehub', false) });
}

async function run() {
    let ind = Main.panel.statusArea.easehub;
    const es = easehubSettings();
    L('indicator present', !!ind, 'icon', ind?._panelIcon.gicon?.to_string().split('/').pop());
    await wait(1500); // let NetworkManager / rfkill proxies arrive

    // Layout overview
    for (const it of items(ind)) {
        const kind = it.constructor.name;
        const names = buttons(it).map(b => `${b.accessible_name}${b.toggle_mode ? (b.checked ? '[on]' : '[off]') : ''}${b.visible ? '' : '(hidden)'}`);
        const sub = it.menu?._getMenuItems ? ` -> ${it.menu._getMenuItems().map(label).join(' | ')}` : '';
        L('item', kind, JSON.stringify(label(it)), names.length ? names.join(', ') : '', sub);
    }

    // Tiles: DND and Dark Mode write isolated gsettings
    const notif = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
    const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    const tile = name => ind._toggles.find(t => t.label === name)?.widget;
    const dnd = tile('Do Not Disturb');
    const before = notif.get_boolean('show-banners');
    dnd.checked = !dnd.checked;
    dnd.emit('clicked', 1);
    L('dnd tile click: show-banners', before, '->', notif.get_boolean('show-banners'));
    iface.set_string('color-scheme', 'prefer-dark');
    ind.menu.open();
    await wait(300);
    L('dark tile synced to prefer-dark on open', tile('Dark Mode').checked);
    ind.menu.close();
    const dark = tile('Dark Mode');
    dark.checked = false;
    dark.emit('clicked', 1);
    L('dark tile off -> color-scheme', iface.get_string('color-scheme'));
    L('radio tiles visible: wifi', tile('Wi-Fi')?.visible, 'bluetooth', tile('Bluetooth')?.visible, 'airplane', tile('Airplane Mode')?.visible);
    L('volume wired', !!ind._volume, 'stream', !!ind._volume?.stream);

    // Captured commands
    const spawned = [];
    const origNew = Gio.Subprocess.new;
    Gio.Subprocess.new = argv => {
        spawned.push(argv);
        return null;
    };
    const sudo = items(ind).find(i => i.menu && label(i).startsWith('Sudo Timeout'));
    es.set_boolean('sudo-global-timestamp', true);
    es.set_int('sudo-custom-minutes', 45);
    await wait(300);
    const sudo2 = items(ind).find(i => i.menu && label(i).startsWith('Sudo Timeout'));
    L('sudo items', sudo2.menu._getMenuItems().map(label).join(' | '));
    findItem(sudo2.menu, '1 hour').activate(null);
    findItem(sudo2.menu, 'Forget Password Now').activate(null);
    const apps = items(ind).find(i => i.menu && label(i) === 'Apps & Files');
    findItem(apps.menu, 'Terminal').activate(null);
    Gio.Subprocess.new = origNew;
    for (const a of spawned)
        L('spawn argv', JSON.stringify(a.map(x => x.length > 90 ? `${x.slice(0, 90)}…` : x)));
    void sudo;

    // Screenshot from the group
    ind.menu.open();
    await wait(300);
    const clip = items(ind).find(i => i.menu && label(i) === 'Clipboard & Screenshot');
    findItem(clip.menu, 'Screenshot').activate(null);
    await wait(1500);
    L('screenshotUI visible', Main.screenshotUI.visible);
    Main.screenshotUI.close(true);
    await wait(500);

    // Hiding items and classic layout rebuild live
    es.set_strv('hidden-actions', ['volume', 'wifi', 'bluetooth', 'airplane', 'keep-awake', 'donate']);
    await wait(200);
    L('after hiding: volume row', !!ind._volume, 'tiles', ind._toggles.map(t => t.label).join(','));
    es.set_string('menu-layout', 'classic');
    await wait(200);
    L('classic: switch items', items(ind).filter(i => i instanceof PopupMenu.PopupSwitchMenuItem).map(label).join(','),
        'power rows', items(ind).filter(i => ['Lock Screen', 'Power Off'].includes(label(i))).length);
    es.reset('menu-layout');
    es.reset('hidden-actions');

    // Panel position moves the icon
    es.set_string('panel-position', 'left');
    await wait(300);
    ind = Main.panel.statusArea.easehub;
    L('position left: in left box', Main.panel._leftBox.contains(ind.container));
    es.reset('panel-position');
    await wait(300);
    ind = Main.panel.statusArea.easehub;

    // Custom icon choice
    es.set_string('panel-icon', 'view-app-grid-symbolic');
    await wait(100);
    L('icon choice', ind._panelIcon.gicon.to_string());
    es.reset('panel-icon');

    // Shortcut toggles the menu
    es.set_strv('toggle-menu-shortcut', ['<Super><Alt>e']);
    await wait(200);
    L('keybinding registered', Main.wm._allowedKeybindings?.['toggle-menu-shortcut'] !== undefined);
    es.reset('toggle-menu-shortcut');

    // Keep Awake: inhibit through the (private) session bus, if a session manager answers
    const awake = ind._toggles.find(t => t.id === 'keep-awake');
    awake.set(true);
    await wait(800);
    L('keep awake cookie', ind._inhibitCookie);
    awake.set(false);

    // Migration from 1.2 'enabled-actions'
    Main.extensionManager.disableExtension(UUID);
    await wait(500);
    es.set_strv('enabled-actions', ['lock', 'dnd', 'settings']);
    Main.extensionManager.enableExtension(UUID);
    await wait(800);
    const hidden = es.get_strv('hidden-actions');
    L('migration: reboot hidden', hidden.includes('reboot'), 'dnd shown', !hidden.includes('dnd'),
        'new items shown', !hidden.includes('volume'), 'old key reset', es.get_user_value('enabled-actions') === null);
    es.reset('hidden-actions');
    await wait(300);
    ind = Main.panel.statusArea.easehub;

    // Confirm dialog closed on disable
    ind._confirm('Test', () => {});
    await wait(500);
    L('dialog open', !!ind._dialog);
    Main.extensionManager.disableExtension(UUID);
    await wait(800);
    L('after disable indicator', !!Main.panel.statusArea.easehub, 'modal count', Main.modalCount);
    Main.extensionManager.enableExtension(UUID);
    await wait(800);
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
