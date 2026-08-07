import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationTokenSource, ResponseError } from 'vscode-languageserver/node';
import type { LanguageServerDiagnosticsStatus } from '../languageServerReadiness';
import { waitForSettledDiagnosticsStatus } from '../workspaceDiagnostics';
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

test('workspace diagnostics returns only the latest settled semantic generation', async () => {
    let current = status(1, 0);
    let now = 0;
    let waits = 0;
    let result = await waitForSettledDiagnosticsStatus(
        () => current,
        undefined,
        {
            timeoutMs: 25,
            pollIntervalMs: 10,
            now: () => now,
            wait: async (delayMs) => {
                waits += 1;
                now += delayMs;
                current = status(2, 2, 'ready');
                return true;
            },
        },
    );
    assert.equal(waits, 1);
    assert.equal(result.semanticGeneration, 2);
    assert.equal(result.settledSemanticGeneration, 2);
});

test('workspace diagnostics hard deadline terminates the handler without further waits', async () => {
    let now = 0;
    let waits = 0;
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => status(3, 2, 'resolving'),
            undefined,
            {
                timeoutMs: 25,
                pollIntervalMs: 10,
                now: () => now,
                wait: async (delayMs) => {
                    waits += 1;
                    now += delayMs;
                    return true;
                },
            },
        ),
        (error: unknown) => error instanceof ResponseError
            && error.code == -32002
            && /within 25ms/u.test(error.message),
    );
    assert.equal(waits, 3);
});

test('workspace diagnostics cancellation terminates the pending wait', async () => {
    let source = new CancellationTokenSource();
    let waits = 0;
    await assert.rejects(
        waitForSettledDiagnosticsStatus(
            () => status(1, 0),
            source.token,
            {
                timeoutMs: 100,
                pollIntervalMs: 10,
                wait: async () => {
                    waits += 1;
                    source.cancel();
                    return false;
                },
            },
        ),
        (error: unknown) => error instanceof ResponseError && error.code == -32800,
    );
    assert.equal(waits, 1);
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
        (error: unknown) => error instanceof ResponseError && error.code == -32002,
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
