import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import { resolveLanguageServerInitializationOptions } from '../languageServerContract';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { loadDebugDatabaseCacheV2, saveDebugDatabaseCacheV2 } from '../debugDatabaseCacheV2';

function identityOptions(root: string)
{
    let uprojectPath = path.join(root, 'Example.uproject');
    return {
        canonicalProjectRoot: root,
        uprojectPath,
        projectIdentity: process.platform == 'win32' ? uprojectPath.toLowerCase() : uprojectPath,
    };
}

function scriptSettings() : Record<string, boolean>
{
    return {
        floatIsFloat64: false,
        useAngelscriptHaze: false,
        deprecateStaticClass: false,
        disallowStaticClass: false,
        exposeGlobalFunctions: false,
        deprecateActorGenerics: false,
        disallowActorGenerics: false,
    };
}

test('roles own distinct fixed read-write v2 cache paths', () => {
    let root = path.resolve('ExampleProject');
    let vscode = resolveLanguageServerInitializationOptions({
        role: 'vscode',
        ...identityOptions(root),
    }, root);
    assert.equal(vscode.cacheAccess, 'read-write');
    assert.equal(vscode.cachePath, path.join(root, 'Script', '.vscode', 'angelscript', 'debug-database.v2.json.gz'));

    let daemon = resolveLanguageServerInitializationOptions({
        role: 'project-daemon',
        ...identityOptions(root),
        unreal: { debuggerPort: 41001 },
    }, root);
    assert.equal(daemon.unrealOnline, true);
    assert.equal(daemon.debuggerPort, 41001);
    assert.equal(daemon.cacheAccess, 'read-write');
    assert.equal(daemon.cachePath, path.join(root, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz'));
});

test('project daemon is always online and enabled writers require exact identity', () => {
    let root = path.resolve('ExampleProject');
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'project-daemon',
        ...identityOptions(root),
        unreal: { online: false, debuggerPort: 41001 },
    }, root), /requires unreal.online=true/u);
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'project-daemon',
        ...identityOptions(root),
        cache: { enabled: false },
        unreal: { debuggerPort: 41001 },
    }, root), /fixed Saved v2 cache writer/u);
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'project-daemon',
        ...identityOptions(root),
    }, root), /project-derived unreal.debuggerPort/u);
    assert.throws(() => resolveLanguageServerInitializationOptions({ role: 'vscode' }, root), /exact uprojectPath/u);
    let disabled = resolveLanguageServerInitializationOptions({ role: 'vscode', cache: { enabled: false } }, root);
    assert.equal(disabled.cacheAccess, 'disabled');
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'vscode',
        cache: { enabled: false, budgets: { maxChunkCount: 0 } },
    }, root), /positive integer/u);
});

test('obsolete roles are rejected', () => {
    for (let role of ['ue-resident', 'cli-direct'])
        assert.throws(() => resolveLanguageServerInitializationOptions({ role: role as never }, process.cwd()), /Invalid initialization option 'role'/u);
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'vscode',
        cache: { path: 'elsewhere' } as never,
    }, process.cwd()), /removed/u);
});

test('VS Code and daemon writers publish isolated v2 generations', () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-role-cache-'));
    try
    {
        let uprojectPath = path.join(root, 'Example.uproject');
        fs.mkdirSync(path.join(root, 'Script'));
        fs.writeFileSync(uprojectPath, '{}');
        let identity = process.platform == 'win32' ? uprojectPath.toLowerCase() : uprojectPath;
        let shared = { canonicalProjectRoot: root, uprojectPath, projectIdentity: identity };
        let vscode = resolveLanguageServerInitializationOptions({ role: 'vscode', ...shared }, root);
        let daemon = resolveLanguageServerInitializationOptions({
            role: 'project-daemon',
            ...shared,
            unreal: { debuggerPort: 41001 },
        }, root);
        for (let [options, typeName] of [[vscode, 'UVSCode'], [daemon, 'UDaemon']] as const)
        {
            let context = {
                cachePath: options.cachePath,
                access: options.cacheAccess,
                projectIdentity: identity,
                budgets: options.budgets,
            };
            saveDebugDatabaseCacheV2(context, {
                projectIdentity: identity,
                producer: { extensionVersion: '1.9.3072', languageServerCommit: 'test' },
                scriptSettings: scriptSettings(),
                engineSupportsCreateBlueprint: false,
                debugDatabaseChunks: [{ [typeName]: {} }],
            });
            let loaded = loadDebugDatabaseCacheV2(context);
            assert.equal(loaded.ok, true);
            if (loaded.ok)
                assert.deepEqual(loaded.cache.debugDatabaseChunks, [{ [typeName]: {} }]);
        }
        assert.notEqual(vscode.cachePath, daemon.cachePath);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
