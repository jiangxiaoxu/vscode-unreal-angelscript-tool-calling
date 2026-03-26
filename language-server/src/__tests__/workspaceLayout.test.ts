import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test = require('node:test');
import {
    IsScriptUri,
    ResolveCacheRoot,
    ResolveInitialScriptIgnorePatterns,
    ResolveScriptRoot,
    ResolveScriptRootUris,
    ResolveScriptRoots
} from '../workspaceLayout';

function createTempDir(prefix: string): string
{
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('ResolveScriptRoot accepts a Script folder directly and via its parent folder', () =>
{
    const root = createTempDir('workspace-layout-');
    const scriptRoot = path.join(root, 'Script');
    fs.mkdirSync(scriptRoot);

    try
    {
        assert.equal(ResolveScriptRoot(root), scriptRoot);
        assert.equal(ResolveScriptRoot(scriptRoot), scriptRoot);
        assert.equal(ResolveCacheRoot([scriptRoot]), scriptRoot);
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('ResolveScriptRoots dedupes duplicate roots on Windows-style case-insensitive paths', () =>
{
    const root = createTempDir('workspace-layout-');
    const scriptRoot = path.join(root, 'Script');
    fs.mkdirSync(scriptRoot);

    try
    {
        const resolved = ResolveScriptRoots([
            root,
            process.platform == 'win32' ? root.toUpperCase() : root
        ]);

        assert.equal(resolved.length, 1);
        assert.equal(resolved[0], scriptRoot);
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('ResolveInitialScriptIgnorePatterns trims invalid values and ResolveScriptRootUris keeps decoded file URIs', () =>
{
    const patterns = ResolveInitialScriptIgnorePatterns({
        scriptIgnorePatterns: ['  Foo/**  ', '', 12, 'Bar/*.as']
    });

    assert.deepEqual(patterns, ['Foo/**', 'Bar/*.as']);

    const uris = ResolveScriptRootUris(
        ['C:\\Game Project\\Script'],
        (pathname) => `file:///${pathname.replace(/\\/g, '/').replace(/ /g, '%20')}`
    );

    assert.deepEqual(uris, ['file:///C:/Game Project/Script']);
});

test('IsScriptUri only matches paths inside resolved Script roots', () =>
{
    const scriptRoots = ['C:\\Game\\Script'];
    const getPathName = (uri: string) => uri.replace('file:///', '').replace(/\//g, '\\');

    assert.equal(IsScriptUri('file:///C:/Game/Script/Player/Test.as', scriptRoots, getPathName), true);
    assert.equal(IsScriptUri('file:///C:/Game/Source/Test.as', scriptRoots, getPathName), false);
    assert.equal(IsScriptUri('untitled:Test.as', scriptRoots, getPathName), false);
});
