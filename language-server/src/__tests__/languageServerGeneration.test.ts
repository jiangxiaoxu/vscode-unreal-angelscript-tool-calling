import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLanguageServerReadinessController } from '../languageServerReadiness';
import { createUnrealCacheController } from '../unrealCacheController';
import { DEFAULT_LANGUAGE_SERVER_BUDGETS } from '../languageServerContract';
import { loadDebugDatabaseCacheV2, saveDebugDatabaseCacheV2 } from '../debugDatabaseCacheV2';
import { AddTypeToDatabase, DBType, GetRootNamespace, GetTypeByName, ResetDatabaseForTests } from '../database';
import * as scriptfiles from '../as_parser';
import { resetTypeDatabaseForGeneration } from '../typeDatabaseGeneration';
import { createDebouncedPublication } from '../debouncedPublication';
import { Complete } from '../parsed_completion';
import { ResolveSymbolAtPosition } from '../symbols';
import { URI } from 'vscode-uri';
import { createLanguageServerAutomationRuntime } from '../languageServerAutomationRuntime';

function nativeType(name: string, methodName?: string) : Record<string, unknown>
{
    return {
        [name]: {
            properties: {},
            methods: methodName ? { [methodName]: { name: methodName, return: 'void', args: [] } } : {},
        },
    };
}

test('beginRefresh atomically revokes ready coverage and the prior revision', () => {
    let notifications: unknown[] = [];
    let readiness = createLanguageServerReadinessController((status) => notifications.push(status));
    readiness.update({ generation: 3, stage: 'ready', fullReady: true, coverage: 'full', revision: 'old' });
    readiness.beginRefresh(4);
    assert.deepEqual(readiness.snapshot(), {
        generation: 4,
        stage: 'loading-cache',
        fullReady: false,
        coverage: 'none',
        unrealOnline: false,
        unrealConnected: false,
        cache: 'not-checked',
        cacheReason: undefined,
        revision: undefined,
    });
    assert.equal(notifications.length, 2);
});

test('cache publication is fenced by generation and cannot publish mixed chunks', async () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ls-generation-'));
    let cachePath = path.join(directory, 'debug-database.v2.json.gz');
    let context = {
        cachePath,
        access: 'read-write' as const,
        projectIdentity: 'generation-project',
        budgets: { ...DEFAULT_LANGUAGE_SERVER_BUDGETS },
    };
    let controller = createUnrealCacheController();
    controller.configure(context, { extensionVersion: 'test', languageServerCommit: 'test' });
    try
    {
        let generation1 = controller.beginRefresh();
        controller.recordDebugDatabaseChunk(nativeType('UGeneration1'));
        controller.hydrateRecordedGeneration();
        let stalePublished = false;
        controller.scheduleWrite(true, () => { stalePublished = true; });

        let generation2 = controller.beginRefresh();
        assert.equal(generation2, generation1 + 1);
        controller.recordDebugDatabaseChunk(nativeType('UGeneration2First'));
        controller.recordDebugDatabaseChunk(nativeType('UGeneration2Second'));
        controller.hydrateRecordedGeneration();
        await new Promise<void>((resolve, reject) => {
            controller.scheduleWrite(true, () => resolve(), reject);
        });

        assert.equal(stalePublished, false);
        let loaded = loadDebugDatabaseCacheV2(context);
        assert.equal(loaded.ok, true);
        if (loaded.ok)
            assert.deepEqual(loaded.cache.debugDatabaseChunks, [
                nativeType('UGeneration2First'),
                nativeType('UGeneration2Second'),
            ]);
    }
    finally
    {
        controller.cancelPendingWrite();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('live refresh preserves the accepted TypeDB and invalid replacement fully restores script resolution', () => {
    ResetDatabaseForTests();
    scriptfiles.ClearAllResolvedModules();
    let controller = createUnrealCacheController();
    controller.beginRefresh();
    controller.recordDebugDatabaseChunk(nativeType('UOldGenerationOnly', 'OldMethod'));
    controller.hydrateRecordedGeneration();
    let acceptedRevision = controller.getRevision();

    let content = [
        'void Probe()',
        '{',
        '    UOldGenerationOnly Value;',
        '    Value.OldMethod();',
        '    Value.',
        '}',
    ].join('\n');
    let filePath = path.join(os.tmpdir(), 'GenerationRollbackFixture.as');
    let uri = URI.file(filePath).toString();
    let module = scriptfiles.GetOrCreateModule('GenerationRollbackFixture', filePath, uri);
    scriptfiles.UpdateModuleFromContent(module, content);
    scriptfiles.LoadAndParseModule(module);
    scriptfiles.PostProcessModuleTypes(module);
    scriptfiles.ResolveModule(module);
    let completionPosition = { line: 4, character: '    Value.'.length };
    let referencePosition = { line: 3, character: '    Value.Old'.length };
    assert.ok(Complete(module, completionPosition)?.some((item) => item.label == 'OldMethod'));
    assert.equal(ResolveSymbolAtPosition(module, referencePosition, true).ok, true);

    controller.beginRefresh();
    controller.recordDebugDatabaseChunk(nativeType('UNewGenerationBuffered'));
    assert.ok(GetTypeByName('UOldGenerationOnly'), 'The active generation must remain available while chunks are buffered.');
    assert.equal(GetTypeByName('UNewGenerationBuffered') == null, true);
    assert.ok(Complete(module, completionPosition)?.some((item) => item.label == 'OldMethod'));

    controller.recordDebugDatabaseChunk({ UInvalidReplacement: { properties: { Broken: null }, methods: {} } });
    assert.throws(() => controller.hydrateRecordedGeneration());
    assert.equal(controller.getRevision(), acceptedRevision);
    assert.ok(GetTypeByName('UOldGenerationOnly'));
    assert.equal(GetTypeByName('UNewGenerationBuffered') == null, true);
    assert.equal(module.resolved, true);
    assert.ok(Complete(module, completionPosition)?.some((item) => item.label == 'OldMethod'));
    assert.equal(ResolveSymbolAtPosition(module, referencePosition, true).ok, true);
});

test('failed live refresh restores the prior full-ready status and revision', () => {
    ResetDatabaseForTests();
    let connection = {
        sendNotification() {},
        onRequest() {},
        languages: { diagnostics: { on() {}, onWorkspace() {} } },
        console: { error() {} },
    } as any;
    let runtime = createLanguageServerAutomationRuntime(connection, '1.9.3070');
    runtime.cache.beginRefresh();
    runtime.cache.recordDebugDatabaseChunk(nativeType('URuntimeAccepted'));
    runtime.cache.hydrateRecordedGeneration();
    let revision = runtime.cache.getRevision()!;
    runtime.readiness.update({ generation: 1, stage: 'ready', fullReady: true, coverage: 'full', revision });

    runtime.beginLiveRefresh();
    runtime.cache.recordDebugDatabaseChunk({ UInvalidRuntimeReplacement: { properties: { Broken: null }, methods: {} } });
    let failure: unknown;
    try { runtime.cache.hydrateRecordedGeneration(); } catch (error) { failure = error; }
    assert.ok(failure);
    runtime.markHydrationFailed(failure);
    assert.deepEqual(runtime.readiness.snapshot(), {
        generation: 2,
        stage: 'ready',
        fullReady: true,
        coverage: 'full',
        unrealOnline: false,
        unrealConnected: true,
        cache: 'not-checked',
        cacheReason: undefined,
        revision,
    });
});

test('cached startup refresh failure advances the restored generation and can finish initial readiness', () => {
    ResetDatabaseForTests();
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ls-startup-rollback-'));
    let cachePath = path.join(directory, 'debug-database.v2.json.gz');
    let projectIdentity = 'startup-rollback-project';
    saveDebugDatabaseCacheV2({
        cachePath,
        access: 'read-write',
        projectIdentity,
        budgets: DEFAULT_LANGUAGE_SERVER_BUDGETS,
    }, {
        projectIdentity,
        producer: { extensionVersion: '1.9.3070', languageServerCommit: 'development' },
        scriptSettings: { floatIsFloat64: false },
        engineSupportsCreateBlueprint: false,
        debugDatabaseChunks: [nativeType('UStartupCached')],
    });
    let connection = {
        sendNotification() {},
        onRequest() {},
        languages: { diagnostics: { on() {}, onWorkspace() {} } },
        console: { error() {} },
    } as any;
    let runtime = createLanguageServerAutomationRuntime(connection, '1.9.3070');
    try
    {
        let loaded = runtime.configure({
            additionalScriptRootFolders: [],
            role: 'ue-resident',
            canonicalProjectRoot: directory,
            projectIdentity,
            unrealOnline: true,
            debuggerPort: 27099,
            cachePath,
            cacheAccess: 'read-write',
            budgets: DEFAULT_LANGUAGE_SERVER_BUDGETS,
        });
        assert.equal(loaded.loaded, true);
        let oldRevision = loaded.revision!;
        assert.equal(runtime.readiness.snapshot().generation, 0);
        runtime.beginLiveRefresh();
        runtime.cache.recordDebugDatabaseChunk({ UInvalidStartupReplacement: { properties: { Broken: null }, methods: {} } });
        let failure: unknown;
        try { runtime.cache.hydrateRecordedGeneration(); } catch (error) { failure = error; }
        runtime.markHydrationFailed(failure);
        assert.equal(runtime.readiness.snapshot().generation, runtime.cache.getGeneration());
        assert.equal(runtime.readiness.snapshot().stage, 'parsing');
        assert.equal(runtime.readiness.snapshot().revision, oldRevision);
        runtime.markCurrentGenerationFullReady();
        assert.equal(runtime.readiness.snapshot().fullReady, true);
        assert.equal(runtime.readiness.snapshot().revision, oldRevision);
    }
    finally
    {
        runtime.shutdown();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('TypeDB refresh replaces the whole generation and reparses script-owned types', () => {
    ResetDatabaseForTests();
    let oldNative = new DBType().initEmpty('UOldGenerationOnly');
    AddTypeToDatabase(GetRootNamespace(), oldNative);
    let module = scriptfiles.GetOrCreateModule(
        'GenerationFixture',
        path.join(os.tmpdir(), 'GenerationFixture.as'),
        'file:///GenerationFixture.as',
    );
    scriptfiles.UpdateModuleFromContent(module, 'class UGenerationScriptType {}\n');
    scriptfiles.ParseModule(module);
    assert.ok(GetTypeByName('UOldGenerationOnly'));
    assert.ok(GetTypeByName('UGenerationScriptType'));

    let reset = resetTypeDatabaseForGeneration();
    assert.ok(reset.reparsedModuleCount >= 1);
    assert.equal(GetTypeByName('UOldGenerationOnly') == null, true);
    assert.ok(GetTypeByName('UGenerationScriptType'));
});

test('debounced index publication drops stale generations and coalesces file changes', async () => {
    let publication = createDebouncedPublication(10);
    let published: number[] = [];
    publication.schedule(1, () => published.push(1));
    publication.schedule(2, () => published.push(2));
    publication.schedule(2, () => published.push(2));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(published, [2]);
    publication.cancel();
});
