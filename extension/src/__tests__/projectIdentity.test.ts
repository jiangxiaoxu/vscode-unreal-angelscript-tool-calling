import * as assert from 'node:assert/strict';
import test = require('node:test');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveWorkspaceProjectIdentity } from '../projectIdentity';

function withProject(run: (root: string) => void) : void
{
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-project-identity-'));
    fs.mkdirSync(path.join(root, 'Script'));
    fs.writeFileSync(path.join(root, 'Example.uproject'), '{}');
    try { run(root); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('resolves the same exact physical project from project and Script workspace folders', () => {
    withProject((root) => {
        let resolved = resolveWorkspaceProjectIdentity([root, path.join(root, 'Script')]);
        assert.ok(resolved.ok);
        assert.equal(resolved.canonicalProjectRoot, fs.realpathSync.native(root));
        assert.equal(resolved.uprojectPath, fs.realpathSync.native(path.join(root, 'Example.uproject')));
        assert.ok(resolved.projectIdentity.length > 0);
    });
});

test('fails closed when no project or multiple physical projects are present', () => {
    let empty = fs.mkdtempSync(path.join(os.tmpdir(), 'as-project-empty-'));
    try
    {
        assert.equal(resolveWorkspaceProjectIdentity([empty]).ok, false);
        fs.writeFileSync(path.join(empty, 'One.uproject'), '{}');
        fs.writeFileSync(path.join(empty, 'Two.uproject'), '{}');
        let multiple = resolveWorkspaceProjectIdentity([empty]);
        assert.equal(multiple.ok, false);
        if (multiple.ok === false)
            assert.match(multiple.reason, /2 physical/u);
    }
    finally { fs.rmSync(empty, { recursive: true, force: true }); }
});
