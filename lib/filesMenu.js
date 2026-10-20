// SPDX-License-Identifier: MIT
// Comfort Control (EaseHub) — Files (Nautilus) right-click menu.
//
// Writes small launcher scripts under ~/.local/share/nautilus/scripts/<name>/
// that call scripts/easehub-files.sh. Only files EaseHub listed in its marker
// are ever removed. No GNOME Shell imports, so prefs and tests can use it.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Files right-click actions: id, default title, group.
export const FILES_ACTIONS = [
    ['copy-name', 'Copy Name', 'copy'],
    ['copy-path', 'Copy Full Path', 'copy'],
    ['copy-path-name', 'Copy Path and Name', 'copy'],
    ['copy-parent', 'Copy Parent Folder Path', 'copy'],
    ['copy-home', 'Copy Path from Home (~)', 'copy'],
    ['copy-quoted', 'Copy Quoted Path (Shell-Safe)', 'copy'],
    ['copy-uri', 'Copy File URI', 'copy'],
    ['open-terminal', 'Open Terminal Here', 'open'],
    ['open-editor', 'Open in Editor', 'open'],
    ['copy-info', 'Copy Size and Type', 'tools'],
    ['copy-sha256', 'Copy SHA-256 Checksum', 'tools'],
    ['make-executable', 'Make Executable', 'tools'],
];
export const FILES_GROUPS = { copy: 'Copy', open: 'Open', tools: 'Tools' };
const MARKER = '.easehub-managed';

// ---------------------------------------------------------------- Files menu sync

// `base` overrides the scripts folder (used by tests).
export function scriptsDir(base = null) {
    return Gio.File.new_for_path(base ?? GLib.build_filenamev([GLib.get_user_data_dir(), 'nautilus', 'scripts']));
}

function shQuote(s) {
    return `'${s.replace(/'/g, "'\\''")}'`;
}

export function cleanName(s) {
    return s.replace(/[/\0]/g, '-').replace(/^\.+/, '').trim();
}

function readText(file) {
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

function writeText(file, text, mode) {
    file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (mode)
        file.set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
}

// Remove every folder EaseHub created earlier: only the files it listed in its
// marker, then folders left empty. Anything you added yourself is kept.
// Returns the names of the folders that were EaseHub's.
export function removeManaged(base = null) {
    const root = scriptsDir(base);
    const cleaned = new Set();
    if (!root.query_exists(null))
        return cleaned;
    const en = root.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = en.next_file(null))) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            continue;
        const dir = root.get_child(info.get_name());
        const marker = dir.get_child(MARKER);
        if (!marker.query_exists(null))
            continue;
        cleaned.add(info.get_name());
        let manifest = [];
        try {
            manifest = JSON.parse(readText(marker)).files ?? [];
        } catch {}
        for (const rel of manifest) {
            if (typeof rel !== 'string' || rel.split('/').includes('..'))
                continue;
            try {
                dir.resolve_relative_path(rel).delete(null);
            } catch {}
        }
        try {
            marker.delete(null);
        } catch {}
        for (const sub of Object.values(FILES_GROUPS)) {
            try {
                dir.get_child(sub).delete(null); // only succeeds when empty
            } catch {}
        }
        try {
            dir.delete(null);
        } catch {}
    }
    en.close(null);
    return cleaned;
}

export function syncFilesMenu(settings, extensionPath, base = null) {
    const ours = removeManaged(base);
    if (!settings.get_boolean('files-actions-enabled'))
        return { ok: true, message: 'Files right-click actions are off' };

    const name = cleanName(settings.get_string('files-menu-name')) || 'EaseHub';
    const root = scriptsDir(base).get_child(name);
    // A folder that was EaseHub's a moment ago (and still holds your own files) is reused.
    if (root.query_exists(null) && !ours.has(name))
        return { ok: false, message: `A folder named "${name}" already exists in the Files scripts folder — choose another name` };

    const helper = GLib.build_filenamev([extensionPath, 'scripts', 'easehub-files.sh']);
    const hidden = new Set(settings.get_strv('files-hidden-actions'));
    const titles = settings.get_value('files-titles').deep_unpack();
    const grouped = settings.get_string('files-layout') !== 'flat';
    const files = [];
    if (!root.query_exists(null))
        root.make_directory_with_parents(null);
    // Write the marker first so a half-finished run can still be cleaned up.
    const writeMarker = () => writeText(root.get_child(MARKER),
        `${JSON.stringify({ managedBy: 'EaseHub', files }, null, 2)}\n`);
    writeMarker();
    for (const [id, defaultTitle, group] of FILES_ACTIONS) {
        if (hidden.has(id))
            continue;
        const base = cleanName(titles[id] ?? '') || defaultTitle;
        const dir = grouped ? root.get_child(FILES_GROUPS[group]) : root;
        if (!dir.query_exists(null))
            dir.make_directory_with_parents(null);
        let title = base;
        for (let n = 2; dir.get_child(title).query_exists(null); n++)
            title = `${base} (${n})`;
        const script = `#!/usr/bin/env bash
# Managed by EaseHub (Preferences → Files). Changes here are overwritten.
helper=${shQuote(helper)}
if [[ ! -f "$helper" ]]; then
    notify-send --app-name=EaseHub EaseHub ${shQuote(`EaseHub is no longer installed. Delete this folder to remove its menu: ${root.get_path()}`)}
    exit 1
fi
exec bash "$helper" ${id} "$@"
`;
        files.push(grouped ? `${FILES_GROUPS[group]}/${title}` : title);
        writeText(dir.get_child(title), script, 0o755);
    }
    writeMarker();
    return { ok: true, message: `Added ${files.length} actions under Scripts ▸ ${name}`, path: root.get_path() };
}
