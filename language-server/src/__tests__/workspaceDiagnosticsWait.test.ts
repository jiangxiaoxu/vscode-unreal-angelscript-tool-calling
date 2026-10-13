import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CancellationToken,
    CancellationTokenSource,
    Connection,
    DocumentDiagnosticParams,
    DocumentDiagnosticReport,
    LSPErrorCodes,
    ResponseError,
    WorkspaceDiagnosticParams,
    WorkspaceDiagnosticReport,
} from 'vscode-languageserver/node';
import type { LanguageServerDiagnosticsStatus } from '../languageServerReadiness';
import { createWorkspaceDiagnosticsRegistry, registerWorkspaceDiagnostics, waitForSettledDiagnosticsStatus, workspaceDiagnosticResultId } from '../workspaceDiagnostics';
import { OnDiagnosticsChanged, UpdateCompileDiagnostics } from '../ls_diagnostics';

function status(
    semanticGeneration: number,
    settledSemanticGeneration: number,
    stage: LanguageServerDiagnosticsStatus['stage'] = 'parsing',
) : LanguageServerDiagnosticsStatus
{
    return {
        generation: semanticGeneration,
        semanticGeneration,
        settledSemanticGeneration,
        stage,
        fullReady: stage == 'ready',
        coverage: stage == 'ready' ? 'full' : 'none',
        unrealOnline: true,
        unrealConnected: false,
        cacheState: 'missing',
        cacheDirty: false,
        persistenceAttempt: 0,
    };
}

for (const scope of ['document', 'workspace'] as const)
{
    test(`${scope} diagnostics requests a retry on timeout and returns the latest settled report`, async () => {
        let documentHandler!: (params: DocumentDiagnosticParams, token: CancellationToken) => Promise<DocumentDiagnosticReport>;
        let workspaceHandler!: (params: WorkspaceDiagnosticParams, token: CancellationToken) => Promise<WorkspaceDiagnosticReport>;
        let connection = {
            languages: {
                diagnostics: {
                    on(handler: typeof documentHandler) { documentHandler = handler; },
                    onWorkspace(handler: typeof workspaceHandler) { workspaceHandler = handler; },
                },
            },
        } as unknown as Connection;
        let registry = createWorkspaceDiagnosticsRegistry();
        let current = status(1, 0);
        let now = 0;
        let uri = 'file:///C:/Fixture/Script/Retry.as';
        registry.update(uri, []);
        registerWorkspaceDiagnostics(connection, registry, () => current, {
            timeoutMs: 25,
            pollIntervalMs: 10,
            now: () => now,
            wait: async (delayMs) => { now += delayMs; return true; },
        });
        let request = () => scope === 'document'
            ? documentHandler({ textDocument: { uri } }, CancellationToken.None)
            : workspaceHandler({ previousResultIds: [] }, CancellationToken.None);
        await assert.rejects(request(), (error: unknown) => {
            assert.ok(error instanceof ResponseError);
            assert.equal(error.code, LSPErrorCodes.ServerCancelled);
            assert.deepEqual(error.data, { retriggerRequest: true });
            return true;
        });
        assert.equal(now, 25);
        let diagnostics = [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: 'Latest finding',
        }];
        registry.update(uri, diagnostics);
        current = status(2, 2, 'ready');
        let resultId = workspaceDiagnosticResultId(registry.get(uri)!.contentHash, current);
        let report = await request();
        assert.deepEqual(report, scope === 'document'
            ? { kind: 'full', resultId, items: diagnostics }
            : { items: [{ kind: 'full', uri, version: null, resultId, items: diagnostics }] });
    });
}

test('workspace diagnostics tolerates slow startup with the default deadline', async () => {
    let current = status(1, 0);
    let now = 0;
    let result = await waitForSettledDiagnosticsStatus(() => current, undefined, {
        now: () => now,
        wait: async (delayMs) => {
            now += delayMs;
            if (now >= 25000)
                current = status(2, 2, 'partial');
            return true;
        },
    });
    assert.equal(result, current);
    assert.equal(result.stage, 'partial');
});

test('workspace diagnostics cancellation terminates the pending wait', async () => {
    let source = new CancellationTokenSource();
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => status(1, 0),
            source.token,
            {
                timeoutMs: 100,
                pollIntervalMs: 10,
                wait: async () => {
                    source.cancel();
                    return false;
                },
            },
        ),
        (error: unknown) => error instanceof ResponseError && error.code == -32800,
    );
    source.dispose();
});

test('workspace diagnostics cancellation wins when the same resume becomes settled', async () => {
    let source = new CancellationTokenSource();
    let current = status(1, 0);
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => current,
            source.token,
            {
                timeoutMs: 100,
                pollIntervalMs: 10,
                wait: async () => {
                    current = status(2, 2, 'ready');
                    source.cancel();
                    return false;
                },
            },
        ),
        (error: unknown) => error instanceof ResponseError && error.code == -32800,
    );
    source.dispose();
});

test('workspace diagnostics initial cancellation wins even when semantics are settled', async () => {
    let source = new CancellationTokenSource();
    source.cancel();
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => status(1, 1, 'ready'),
            source.token,
        ),
        (error: unknown) => error instanceof ResponseError && error.code == -32800,
    );
    source.dispose();
});

test('workspace diagnostics hard deadline wins when settle arrives after an event-loop overshoot', async () => {
    let now = 0;
    let current = status(1, 0);
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => current,
            undefined,
            {
                timeoutMs: 20,
                pollIntervalMs: 10,
                now: () => now,
                wait: async () => {
                    now = 25;
                    current = status(2, 2, 'ready');
                    return true;
                },
            },
        ),
        (error: unknown) => error instanceof ResponseError && error.code == LSPErrorCodes.ServerCancelled,
    );
});

test('workspace diagnostics excludes Editor compile diagnostics from Project Static', () => {
    const uri = 'file:///C:/Fixture/Script/CompileOnly.as';
    let observed: { combined: number; projectStatic: number } | null = null;
    OnDiagnosticsChanged((changedUri, combined, projectStatic) => {
        if (changedUri === uri)
            observed = { combined: combined.length, projectStatic: projectStatic.length };
    });
    UpdateCompileDiagnostics(uri, [{
        range: {
            start: { line: 59, character: 4 },
            end: { line: 59, character: 47 },
        },
        severity: 1,
        message: 'Compile-only finding',
        source: 'as',
    }]);
    assert.deepEqual(observed, { combined: 1, projectStatic: 0 });
});
