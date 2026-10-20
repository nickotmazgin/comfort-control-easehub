// EaseHub showcase driver — runs ONLY inside the isolated nested shell started by
// tools/media/showcase.py. Never shipped in the release zip.
//
// It drives the real EaseHub menu with a virtual pointer and keyboard, takes
// pixel-exact screenshots with GNOME's own screenshot API (shots mode), or
// performs a timed tour while the nested window is recorded (video mode).
//
// Safety: power buttons, Wi-Fi/Bluetooth/Airplane tiles, volume buttons and all
// Sudo Timeout items talk to the real system (logind, NetworkManager, audio,
// sudo), so they are only ever hovered. Clicks go through clickLabel()/clickActor()
// on an explicit allow-list, found by label text rather than by coordinates.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'comfort-control@nickotmazgin';
const OUT = GLib.getenv('EASEHUB_SHOWCASE_OUT');
const MODE = GLib.getenv('EASEHUB_SHOWCASE_MODE') ?? 'shots';
const DEMO_DIR = GLib.getenv('EASEHUB_SHOWCASE_DEMO_DIR');
const SCALE = Number(GLib.getenv('EASEHUB_SHOWCASE_SCALE') ?? '1');
const DEBUG = GLib.getenv('EASEHUB_SHOWCASE_DEBUG') === '1';
const ALLOWED_CLICKS = new Set([
    'Apps & Files', 'Clipboard & Screenshot', 'Updates & System', 'Sudo Timeout',  // group headers
    'Screenshot', 'Upgrade Packages…', 'Dark Mode', 'EaseHub Settings', 'Menu appearance',
]);

const log = (...a) => console.log('EHSHOW', ...a);
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
const now = () => GLib.get_monotonic_time();

let pointer, keyboard;
let px = 800, py = 500;

function initInput() {
    const seat = Clutter.get_default_backend().get_default_seat();
    pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
}

async function moveTo(x, y, ms = MODE === 'video' ? 450 : 0) {
    const steps = ms ? Math.max(8, Math.round(ms / 16)) : 1;
    const [sx, sy] = [px, py];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;   // ease in-out
        px = sx + (x - sx) * e;
        py = sy + (y - sy) * e;
        pointer.notify_absolute_motion(now(), px, py);
        if (ms)
            await wait(16);
    }
    await wait(60);
}

function centerOf(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x + w / 2, y + h / 2];
}

let hovered = null;
async function hover(actor, pause = 700, tip = null) {
    if (SCALE === 2) {
        // At 2× the virtual pointer does not land where we aim. Setting
        // actor.hover is not enough: the shell clears it before the tooltip
        // delay, so show the label directly when we know the text.
        if (hovered && hovered !== actor) {
            hovered.hover = false;
            indicator()._tooltips?.hide();
        }
        hovered = actor;
        if (tip) {
            // Setting hover also schedules a second label 450 ms later, and
            // Tooltips._show does not remove the previous one, so the first
            // "Restart" label would stay on top of every later shot.
            actor.hover = false;
            const tips = indicator()._tooltips;
            tips.hide();
            tips._show(actor, tip);
        } else {
            actor.hover = true;
        }
    } else {
        await moveTo(...centerOf(actor));
    }
    await wait(pause);
}

async function pressButton(button = Clutter.BUTTON_PRIMARY) {
    pointer.notify_button(now(), button, Clutter.ButtonState.PRESSED);
    await wait(70);
    pointer.notify_button(now(), button, Clutter.ButtonState.RELEASED);
    await wait(150);
}

async function clickActor(actor, name) {
    if (!ALLOWED_CLICKS.has(name))
        throw new Error(`refusing to click "${name}"`);
    await hover(actor, MODE === 'video' ? 450 : 250);
    await pressButton();
}

async function key(keyval) {
    keyboard.notify_keyval(now(), keyval, Clutter.KeyState.PRESSED);
    await wait(40);
    keyboard.notify_keyval(now(), keyval, Clutter.KeyState.RELEASED);
    await wait(150);
}

async function scroll(times) {
    for (let i = 0; i < times; i++) {
        pointer.notify_discrete_scroll(now(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
        await wait(MODE === 'video' ? 70 : 25);
    }
    await wait(500);
}

// ------------------------------------------------------------------ screenshots

async function shotBytes(x, y, w, h) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    await new Shell.Screenshot().screenshot_area(Math.round(x), Math.round(y), Math.round(w), Math.round(h), stream);
    stream.close(null);
    return stream.steal_as_bytes();
}

async function shot(name, x, y, w, h) {
    if (MODE !== 'shots')
        return null;
    const bytes = await shotBytes(x, y, w, h);
    Gio.File.new_for_path(`${OUT}/${name}.png`).replace_contents(bytes.toArray(), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    log('saved', name);
    return bytes;
}

function extents(actor, pad = 0) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x - pad, y - pad, w + 2 * pad, h + 2 * pad];
}

// Menu plus the top bar above it, so the highlighted EaseHub icon is visible.
async function menuShot(ind, name) {
    await wait(350);
    const [mx, my, mw, mh] = extents(ind.menu.actor, 0);
    const [ix] = centerOf(ind);
    const left = Math.max(0, Math.min(mx - 16, ix - 60));
    const right = Math.min(global.stage.width, Math.max(mx + mw + 16, ix + 60));
    return shot(name, left, 0, right - left, my + mh + 16);
}

// ------------------------------------------------------------------ helpers

function indicator() {
    return Main.panel.statusArea.easehub;
}

function easehubSettings() {
    const ext = Main.extensionManager.lookup(UUID);
    const src = Gio.SettingsSchemaSource.new_from_directory(`${ext.path}/schemas`,
        Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({ settings_schema: src.lookup('org.gnome.shell.extensions.easehub', false) });
}

function groups(ind) {
    return ind.menu._getMenuItems().filter(i => i.menu && i.label);
}

function footerButtons(ind) {
    const footer = ind.menu._getMenuItems().at(-1);
    const out = [];
    const walk = a => {
        if (a instanceof St.Button)
            out.push(a);
        for (const c of a.get_children?.() ?? [])
            walk(c);
    };
    walk(footer);
    return out;
}

function rowButtons(ind, index) {
    const row = ind.menu._getMenuItems()[index];
    const out = [];
    const walk = a => {
        if (a instanceof St.Button)
            out.push(a);
        for (const c of a.get_children?.() ?? [])
            walk(c);
    };
    walk(row);
    return out;
}

function tile(ind, label) {
    return ind._toggles.find(t => t.label === label)?.widget;
}

async function openMenu(ind) {
    if (!ind.menu.isOpen)
        ind.menu.open();
    await wait(MODE === 'video' ? 700 : 450);
}

async function closeMenu(ind) {
    for (const g of groups(ind))
        g.setSubmenuShown(false);
    ind.menu.close();
    await wait(400);
}

// Narration lengths (seconds) from the driver: a scene starts only after the
// previous line has been spoken, so voices never overlap.
const DURATIONS = JSON.parse(GLib.getenv('EASEHUB_SHOWCASE_DURATIONS') || '{}');
let voiceEnd = 0;

async function scene(key, caption) {
    if (MODE === 'video') {
        const waitMs = (voiceEnd - now()) / 1000 + 300;
        if (waitMs > 0)
            await wait(waitMs);
        voiceEnd = now() + (DURATIONS[key] ?? 0) * 1e6;
    }
    log('SCENE', JSON.stringify({ key, caption, t: GLib.get_real_time() }));
}

async function findWindow(match, timeoutMs = 20000) {
    const end = now() + timeoutMs * 1000;
    while (now() < end) {
        const w = global.get_window_actors().map(a => a.meta_window).find(match);
        if (w)
            return w;
        await wait(250);
    }
    const titles = global.get_window_actors().map(a => {
        const w = a.meta_window;
        return `${w.get_wm_class()} | ${w.get_title()}`;
    });
    throw new Error(`window did not appear; saw: ${titles.join(' ;; ') || 'none'}`);
}

async function placeWindow(win, w, h) {
    win.unmaximize?.(Meta.MaximizeFlags.BOTH);
    const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    win.move_resize_frame(false, area.x + (area.width - w) / 2, area.y + (area.height - h) / 2, w, h);
    Main.activateWindow(win);
    await wait(900);
    return win.get_frame_rect();
}

function spawn(argv, envp = null) {
    GLib.spawn_async(null, argv, envp, GLib.SpawnFlags.SEARCH_PATH, null);
}

// Nested Shell often has the real DISPLAY=:0 in its environment. A GTK app
// then opens on the real desktop (or fails when Xwayland did not start) and
// never shows up inside the nested session.
function spawnNestedApp(argv) {
    const env = GLib.get_environ().filter(e => !e.startsWith('DISPLAY=') && !e.startsWith('GDK_BACKEND='));
    env.push('GDK_BACKEND=wayland');
    spawn(argv, env);
}

// ------------------------------------------------------------------ tour

async function tourMenu(ind, es) {
    await scene('title', null);
    await wait(MODE === 'video' ? 4000 : 0);

    await openMenu(ind);
    await menuShot(ind, '01-panel-menu');

    await scene('power', 'Power: lock, log out, suspend, restart, power off');
    for (const b of rowButtons(ind, 0))
        await hover(b, MODE === 'video' ? 900 : 0);         // hover only (real system)
    const restart = rowButtons(ind, 0).find(b => b.accessible_name === 'Restart') ?? rowButtons(ind, 0)[0];
    await hover(restart, 1000, restart.accessible_name || 'Restart');
    await menuShot(ind, '02-panel-menu-tooltip');
    ind._tooltips?.hide();
    if (hovered)
        hovered.hover = false;
    hovered = null;

    await scene('sound', 'Sound: mute, volume down and up');
    for (const b of rowButtons(ind, 1))
        await hover(b, MODE === 'video' ? 800 : 0);         // hover only (real audio)

    await scene('toggles', 'Quick toggles show their state — hover for details');
    for (const t of ind._toggles.filter(x => x.widget.visible))
        await hover(t.widget, MODE === 'video' ? 650 : 0);

    // Groups are expanded in code: the cursor is not recorded, and a synthetic
    // click must never land on a real action.
    for (const [i, g] of groups(ind).entries()) {
        const key = ['apps', 'clip', 'sys', 'sudo'][i];
        await scene(key, {
            apps: 'Apps & Files: Files, Settings, Trash, Recent files, right-click actions',
            clip: "Clipboard & Screenshot — GNOME's own screenshot tool",
            sys: 'Updates & System — risky actions always ask first',
            sudo: 'Sudo Timeout — visudo-checked, with Forget Password Now',
        }[key]);
        await hover(g, 300);
        g.setSubmenuShown(true);
        await wait(600);
        if (MODE === 'video') {
            for (const it of g.menu._getMenuItems())
                await hover(it, 450);                       // hover only
        }
        await hover(g, 300);
        await menuShot(ind, `0${3 + i}-menu-${key}`);
        if (key === 'clip' && MODE === 'video') {
            const item = g.menu._getMenuItems().find(x => x.label?.text === 'Screenshot');
            await hover(item, 400);
            item.activate(Clutter.get_current_event());     // GNOME's screenshot UI
            await wait(3200);
            await key_(Clutter.KEY_Escape);
            await wait(800);
            await openMenu(ind);
            continue;
        }
        if (key === 'sys') {
            const item = g.menu._getMenuItems().find(x => x.label?.text === 'Upgrade Packages…');
            await hover(item, 300);
            item.activate(Clutter.get_current_event());     // opens the confirm dialog only
            await wait(900);
            if (ind._dialog) {
                const [dx, dy, dw, dh] = extents(ind._dialog.dialogLayout ?? ind._dialog, 40);
                await shot('07-confirm-dialog', dx, dy, dw, dh);
                await wait(MODE === 'video' ? 2200 : 100);
                ind._dialog.close();                        // Cancel — never Proceed
            } else {
                log('FAIL confirm dialog did not open');
            }
            await wait(600);
            await openMenu(ind);
            continue;
        }
        g.setSubmenuShown(false);
        await wait(300);
    }
    for (const g of groups(ind))
        g.setSubmenuShown(false);

    await scene('appearance', 'Appearance: System, Light or Dark — one click in the footer');
    const appearance = footerButtons(ind).find(b => b.accessible_name === 'Menu appearance');
    for (const name of ['light', 'dark']) {
        await hover(appearance, 300);
        es.set_string('menu-style', name);                  // same as clicking the footer button
        await wait(MODE === 'video' ? 1400 : 900);
        await menuShot(ind, `08-appearance-${name}`);
    }
    es.reset('menu-style');
    await wait(500);
    await closeMenu(ind);
}

async function tourFiles() {
    await scene('files', 'Files right-click menu: Scripts ▸ EaseHub ▸ Copy, Open, Tools');
    spawnNestedApp(['nautilus', '--new-window', DEMO_DIR]);
    const win = await findWindow(w => w.get_wm_class() === 'org.gnome.Nautilus' && w.get_title()?.includes('EaseHub Demo'), 60000);
    await wait(1200);
    const r = await placeWindow(win, 1000, 640);
    // Keyboard only after one click that focuses the file view. Right opens a
    // submenu (Return does not). Escape closes the whole stack, so each group
    // is opened from a fresh context menu. The pointer is parked in the corner
    // first: left over the menu, it highlights "Copy to…" and the arrows miss.
    const dbg = async name => {
        if (DEBUG)
            await shot(`dbg-${name}`, r.x, r.y, r.width, r.height);
    };
    const stillDemo = () => {
        if (!win.get_title()?.includes('EaseHub Demo'))
            throw new Error(`Files left the demo folder: ${win.get_title()}`);
    };
    const nav = (GLib.getenv('EASEHUB_SHOWCASE_NAV') ?? '1,1,1').split(',').map(Number);
    const focusView = async () => {
        Main.activateWindow(win);
        await wait(300);
        await keys(Clutter.KEY_Escape, 3);
        await moveTo(r.x + Math.round(r.width * 0.55), r.y + Math.round(r.height * 0.62));
        await pressButton();
        await wait(150);
        await moveTo(global.stage.width - 4, global.stage.height - 4);
        await wait(150);
        await key_(Clutter.KEY_Home);                       // first item, "Reports"
        await wait(250);
    };
    for (const [i, group] of ['Copy', 'Open', 'Tools'].entries()) {
        await focusView();
        await key_(Clutter.KEY_Menu);
        await wait(900);
        await dbg(`${i}-a-context`);
        stillDemo();
        await keys(Clutter.KEY_Down, nav[0]);              // Open → Scripts
        await key_(Clutter.KEY_Right);
        await wait(700);
        await keys(Clutter.KEY_Down, nav[1]);              // Scripts header → EaseHub
        await key_(Clutter.KEY_Right);
        await wait(700);
        await keys(Clutter.KEY_Down, nav[2] + i);          // EaseHub header → Copy / Open / Tools
        await key_(Clutter.KEY_Right);
        await wait(MODE === 'video' ? 1800 : 800);
        stillDemo();
        await dbg(`d-${group.toLowerCase()}`);
        await shot(`09-files-right-click-${group.toLowerCase()}`, r.x + 8, r.y, r.width - 16, r.height);
        await keys(Clutter.KEY_Escape, 3);
        await wait(200);
    }
    win.delete(global.get_current_time());
    await wait(800);
}

async function tourPrefs(ind, es) {
    await scene('settings', 'EaseHub Settings — always at the bottom of the menu');
    // Let D-Bus-activated apps (the prefs window) open on this nested display.
    spawn(['dbus-update-activation-environment', 'WAYLAND_DISPLAY', 'DISPLAY', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME']);
    await wait(800);
    es.set_string('prefs-page', 'general');
    await openMenu(ind);
    const settingsButton = footerButtons(ind).find(b => b.accessible_name === 'EaseHub Settings');
    await clickActor(settingsButton, 'EaseHub Settings');
    const win = await findWindow(w => w.get_title() === 'Comfort Control (EaseHub)', 30000);
    await wait(1500);
    const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    const r = await placeWindow(win, 860, Math.min(1000, area.height - 16));

    if (MODE === 'video') {
        await scene('darkmode', 'Dark Mode from the panel — apps follow instantly');
        for (let i = 0; i < 2; i++) {
            await openMenu(ind);
            await clickActor(tile(ind, 'Dark Mode'), 'Dark Mode');
            await wait(2200);
            ind.menu.close();
            await wait(500);
        }
        Main.activateWindow(win);
        await wait(600);
    }

    const tabs = { general: -185, menu: -63, files: 61, about: 184 };
    const captions = {
        general: 'General — layout, appearance, icon, position, shortcut, terminal',
        menu: 'Menu — show only the items you want',
        files: 'Files — rename, hide or regroup the right-click actions',
        about: 'GNOME Shell 45–51 · Wayland & X11',
    };
    let n = 10;
    for (const [page, dx] of Object.entries(tabs)) {
        await scene(page === 'files' ? 'files_tab' : page, captions[page]);
        await moveTo(r.x + r.width / 2 + dx, r.y + 23);
        await pressButton();
        await wait(800);
        await moveTo(r.x + r.width / 2, r.y + r.height / 2);
        let prev = null;
        for (let part = 1; part <= 8; part++) {
            const bytes = MODE === 'shots'
                ? await shotBytes(r.x, r.y + 60, r.width, r.height - 80) : null;
            if (prev && bytes && prev.equal(bytes))
                break;
            await shot(`${n}-settings-${page}-${part}`, r.x, r.y, r.width, r.height);
            n++;
            prev = bytes;
            await scroll(MODE === 'video' ? 10 : 9);
            if (MODE === 'video' && part >= 4)
                break;
        }
    }
    win.delete(global.get_current_time());
    await wait(600);
}

async function key_(keyval) {
    await key(keyval);
}

async function keys(keyval, times) {
    for (let i = 0; i < times; i++)
        await key(keyval);
}

async function run() {
    initInput();
    const ind = indicator();
    const es = easehubSettings();
    // Files right-click actions on (written under this session's private data dir).
    const ext = Main.extensionManager.lookup(UUID);
    const { syncFilesMenu } = await import(`file://${ext.path}/lib/filesMenu.js`);
    es.set_boolean('files-actions-enabled', true);
    syncFilesMenu(es, ext.path);
    await moveTo(700, 400);
    await wait(1500);

    log('START', GLib.get_real_time());
    const parts = (GLib.getenv('EASEHUB_SHOWCASE_PARTS') ?? 'menu,files,prefs').split(',');
    if (parts.includes('menu'))
        await tourMenu(ind, es);
    if (parts.includes('files'))
        await tourFiles();
    if (parts.includes('prefs'))
        await tourPrefs(ind, es);
    await scene('end', 'Free & open source · github.com/nickotmazgin/comfort-control-easehub');
    await wait(MODE === 'video' ? Math.max(5000, (voiceEnd - now()) / 1000 + 1500) : 0);
    log('DONE');
}

export default class Showcase extends Extension {
    enable() {
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._id = 0;
            run().catch(e => log('FAIL', e, e.stack));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
    }
}
