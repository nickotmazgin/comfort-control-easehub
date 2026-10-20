// Tests lib/filesMenu.js against a temporary scripts folder (never your real one).
import GLib from 'gi://GLib';
import { syncFilesMenu } from '../../lib/filesMenu.js';
// Usage: gjs -m tools/tests/files-menu.test.js <empty temp dir> <repo dir>
const [base, ext] = ARGV;
let failures = 0;
const vals = { 'files-actions-enabled': true, 'files-menu-name': 'EaseHub', 'files-layout': 'grouped', 'files-hidden-actions': [], 'files-titles': {} };
const S = {
  get_boolean: k => vals[k], get_string: k => vals[k], get_strv: k => vals[k],
  get_value: k => ({ deep_unpack: () => ({ ...vals[k] }) }),
};
const tree = () => {
  const [, out] = GLib.spawn_command_line_sync(`bash -c "cd '${base}' && find . | sort"`);
  return new TextDecoder().decode(out).trim().split('\n').filter(l => l !== '.');
};
const check = (name, cond) => {
    if (!cond)
        failures++;
    print(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
};
let r = syncFilesMenu(S, ext, base);
check('grouped: 12 actions', r.ok && tree().filter(p => p.split('/').length === 4).length === 12);
check('grouped: marker present', tree().includes('./EaseHub/.easehub-managed'));
// user adds own file inside managed folder -> kept on resync
GLib.file_set_contents(`${base}/EaseHub/Copy/My Own Script`, '#!/bin/sh\n');
vals['files-layout'] = 'flat'; vals['files-hidden-actions'] = ['make-executable']; vals['files-titles'] = { 'copy-name': 'Name/Only' };
r = syncFilesMenu(S, ext, base);
check('flat resync ok', r.ok);
const t = tree();
check('user file kept after resync', t.includes('./EaseHub/Copy/My Own Script'));
check('flat: 11 actions at top level', t.filter(p => /^\.\/EaseHub\/[^/]+$/.test(p) && !p.endsWith('.easehub-managed') && !p.endsWith('/Copy')).length === 11);
check('hidden action absent', !t.some(p => p.endsWith('Make Executable')));
check('slash in title sanitised', t.includes('./EaseHub/Name-Only'));
// collision with a folder the user owns
GLib.mkdir_with_parents(`${base}/Mine`, 0o755);
vals['files-menu-name'] = 'Mine';
r = syncFilesMenu(S, ext, base);
check('collision refused', !r.ok && /already exists/.test(r.message));
check('collision left user folder alone', tree().includes('./Mine'));
vals['files-menu-name'] = 'Tools Hub';
r = syncFilesMenu(S, ext, base);
check('rename moves menu', r.ok && tree().includes('./Tools Hub/.easehub-managed') && tree().includes('./Tools Hub/Copy Full Path'));
// disable removes everything EaseHub added
vals['files-actions-enabled'] = false;
r = syncFilesMenu(S, ext, base);
check('disable ok', r.ok);
check('disable removes managed folder', !tree().some(p => p.startsWith('./Tools Hub')));
check('disable keeps the user folder with own file', tree().includes('./EaseHub/Copy/My Own Script') && tree().includes('./Mine'));
vals['files-actions-enabled'] = true; vals['files-menu-name'] = 'EaseHub2'; vals['files-layout'] = 'grouped';
syncFilesMenu(S, ext, base);
check('grouped: Copy submenu drops the "Copy" prefix', tree().includes('./EaseHub2/Copy/Full Path') && tree().includes('./EaseHub2/Tools/Copy SHA-256 Checksum'));
if (failures)
    throw new Error(`${failures} check(s) failed`);
print('ALL PASSED');
