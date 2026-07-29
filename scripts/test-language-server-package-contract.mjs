import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const languageServerDist = path.join(root, 'language-server', 'dist');
const obsolete = [
    path.join(languageServerDist, 'api-query-index.js'),
    path.join(languageServerDist, 'api-query-index.js.map'),
];
fs.mkdirSync(languageServerDist, { recursive: true });
for (const file of obsolete)
    fs.writeFileSync(file, 'stale');

let build = spawnSync(process.execPath, [path.join(root, 'language-server', 'esbuild.js')], {
    cwd: path.join(root, 'language-server'),
    encoding: 'utf8',
    windowsHide: true,
});
assert.equal(build.status, 0, build.stderr || build.stdout);
for (const file of obsolete)
    assert.equal(fs.existsSync(file), false, `${file} survived a normal build.`);

let listed = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vsce', 'vsce'), 'ls'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
});
assert.equal(listed.status, 0, listed.stderr || listed.stdout);
assert.doesNotMatch(listed.stdout, /api-query-index|apiQueryIndex/u);
assert.match(listed.stdout, /language-server\/dist\/server\.js/u);
assert.match(listed.stdout, /language-server\/dist\/debug-database-cache-worker\.js/u);
console.log('Language Server package artifact contract passed.');
