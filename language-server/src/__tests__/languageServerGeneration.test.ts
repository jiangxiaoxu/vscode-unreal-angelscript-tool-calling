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
import { createActiveWorkTracker } from '../activeWorkTracker';

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
        semanticGeneration: 1,
        settledSemanticGeneration: 0,
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

test('semantic generations remain unsettled until parsing and resolution explicitly finish', () => {
    let readiness = createLanguageServerReadinessController(() => {});
    readiness.markFullReady();
    assert.equal(readiness.snapshot().semanticGeneration, 0);
    assert.equal(readiness.snapshot().settledSemanticGeneration, 0);

    assert.equal(readiness.beginSemanticRefresh(), 1);
    assert.deepEqual(readiness.snapshot(), {
        generation: 0,
        semanticGeneration: 1,
        settledSemanticGeneration: 0,
        stage: 'parsing',
        fullReady: false,
        coverage: 'none',
        unrealOnline: false,
        unrealConnected: false,
        cache: 'not-checked',
    });

    readiness.markFullReady();
    assert.equal(readiness.snapshot().fullReady, true);
    assert.equal(readiness.snapshot().semanticGeneration, 1);
    assert.equal(readiness.snapshot().settledSemanticGeneration, 1);
    assert.throws(() => readiness.update({ semanticGeneration: 0 }), /cannot move backwards/);

    readiness.beginSemanticRefresh();
    assert.throws(() => readiness.update({ fullReady: true }), /requires a settled semantic generation/);

    readiness.markPartialReady('Parsing is still in progress.', false);
    assert.equal(readiness.snapshot().stage, 'partial');
    assert.ok(readiness.snapshot().semanticGeneration > readiness.snapshot().settledSemanticGeneration);
    readiness.markPartialReady('Parsing completed.');
    assert.equal(readiness.snapshot().semanticGeneration, readiness.snapshot().settledSemanticGeneration);
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
        semanticGeneration: 1,
        settledSemanticGeneration: 1,
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

test('hydration failure without a prior cache does not settle unfinished script parsing', () => {
    let connection = {
        sendNotification() {},
        onRequest() {},
        languages: { diagnostics: { on() {}, onWorkspace() {} } },
        console: { error() {} },
    } as any;
    let runtime = createLanguageServerAutomationRuntime(connection, '1.9.3070');
    runtime.beginScriptSemanticRefresh();
    runtime.markHydrationFailed(new Error('invalid initial generation'));
    let status = runtime.readiness.snapshot();
    assert.equal(status.stage, 'partial');
    assert.equal(status.fullReady, false);
    assert.ok(status.semanticGeneration > status.settledSemanticGeneration);
});

test('script changes during a failed native refresh remain fenced until separately settled', () => {
    ResetDatabaseForTests();
    let connection = {
        sendNotification() {},
        onRequest() {},
        languages: { diagnostics: { on() {}, onWorkspace() {} } },
        console: { error() {} },
    } as any;
    let runtime = createLanguageServerAutomationRuntime(connection, '1.9.3070');
    runtime.cache.beginRefresh();
    runtime.cache.recordDebugDatabaseChunk(nativeType('UInterleavedAccepted'));
    runtime.cache.hydrateRecordedGeneration();
    let revision = runtime.cache.getRevision()!;
    runtime.readiness.update({ generation: 1, stage: 'ready', fullReady: true, coverage: 'full', revision });

    runtime.beginLiveRefresh();
    runtime.beginScriptSemanticRefresh();
    runtime.markCurrentGenerationFullReady();
    assert.equal(runtime.readiness.snapshot().fullReady, false);
    assert.equal(runtime.nativeRefreshPending, true);

    runtime.cache.recordDebugDatabaseChunk({ UInvalidInterleavedReplacement: { properties: { Broken: null }, methods: {} } });
    let failure: unknown;
    try { runtime.cache.hydrateRecordedGeneration(); } catch (error) { failure = error; }
    runtime.markHydrationFailed(failure);
    let failed = runtime.readiness.snapshot();
    assert.equal(runtime.nativeRefreshPending, false);
    assert.equal(failed.fullReady, false);
    assert.equal(failed.stage, 'parsing');
    assert.ok(failed.semanticGeneration > failed.settledSemanticGeneration);
    assert.equal(failed.revision, revision);

    runtime.markCurrentGenerationFullReady();
    let settled = runtime.readiness.snapshot();
    assert.equal(settled.fullReady, true);
    assert.equal(settled.semanticGeneration, settled.settledSemanticGeneration);
});

test('a stale re-resolve completion settles work left pending by a failed newer native refresh', () => {
    ResetDatabaseForTests();
    let connection = {
        sendNotification() {},
        onRequest() {},
        languages: { diagnostics: { on() {}, onWorkspace() {} } },
        console: { error() {} },
    } as any;
    let runtime = createLanguageServerAutomationRuntime(connection, '1.9.3070');
    runtime.cache.beginRefresh();
    runtime.cache.recordDebugDatabaseChunk(nativeType('UStaleResolveAccepted'));
    runtime.cache.hydrateRecordedGeneration();
    let revision = runtime.cache.getRevision()!;
    runtime.readiness.update({ generation: 1, stage: 'ready', fullReady: true, coverage: 'full', revision });

    let settledCount = 0;
    let tracker = createActiveWorkTracker(() => {
        settledCount += 1;
        runtime.markCurrentGenerationFullReady();
    });
    let finishStaleResolve = tracker.begin();

    runtime.beginLiveRefresh();
    runtime.beginScriptSemanticRefresh();
    runtime.cache.recordDebugDatabaseChunk({ UInvalidNewerRefresh: { properties: { Broken: null }, methods: {} } });
    let failure: unknown;
    try { runtime.cache.hydrateRecordedGeneration(); } catch (error) { failure = error; }
    runtime.markHydrationFailed(failure);
    assert.equal(runtime.nativeRefreshPending, false);
    assert.equal(runtime.readiness.snapshot().fullReady, false);
    assert.equal(tracker.hasActiveWork(), true);

    finishStaleResolve();
    assert.equal(settledCount, 1);
    assert.equal(tracker.hasActiveWork(), false);
    assert.equal(runtime.readiness.snapshot().fullReady, true);
    assert.equal(runtime.readiness.snapshot().semanticGeneration,
        runtime.readiness.snapshot().settledSemanticGeneration);
    assert.throws(finishStaleResolve, /only be reported once/);
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
