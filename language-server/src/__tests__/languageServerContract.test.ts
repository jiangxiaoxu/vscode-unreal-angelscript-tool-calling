import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import { resolveLanguageServerInitializationOptions } from '../languageServerContract';

test('language server initialization defaults VS Code to online read-only Saved cache', () => {
    let root = path.resolve('ExampleProject');
    let options = resolveLanguageServerInitializationOptions({ role: 'vscode' }, root);
    assert.equal(options.role, 'vscode');
    assert.equal(options.unrealOnline, true);
    assert.equal(options.cacheAccess, 'read-only');
    assert.equal(options.cachePath, path.join(root, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz'));
});

test('only ue-resident may request write ownership and budgets are validated', () => {
    assert.throws(() => resolveLanguageServerInitializationOptions({
        role: 'cli-direct',
        cache: { access: 'read-write' },
    }, process.cwd()), /Only role 'ue-resident'/);
    assert.throws(() => resolveLanguageServerInitializationOptions({
        cache: { budgets: { maxChunkCount: 0 } },
    }, process.cwd()), /positive integer/);
    let resident = resolveLanguageServerInitializationOptions({
        role: 'ue-resident',
        unreal: { online: false, debuggerPort: 27101 },
    }, process.cwd());
    assert.equal(resident.cacheAccess, 'read-write');
    assert.equal(resident.unrealOnline, false);
    assert.equal(resident.debuggerPort, 27101);
});
