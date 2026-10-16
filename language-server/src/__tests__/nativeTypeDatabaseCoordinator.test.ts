import assert from 'node:assert/strict';
import test from 'node:test';
import { Socket } from 'node:net';
import { createNativeTypeDatabaseCoordinator } from '../nativeTypeDatabaseCoordinator';
import { UnrealTransportDiagnostics } from '../unrealTransportDiagnostics';
import { DEFAULT_LANGUAGE_SERVER_BUDGETS } from '../languageServerContract';

type Options = Parameters<typeof createNativeTypeDatabaseCoordinator>[0];
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(role = 'vscode', request?: (method: string, params: any) => Promise<any>) {
    const socket = new Socket();
    let resolveCommit: () => void;
    const commitReady = new Promise<void>((resolve) => { resolveCommit = resolve; });
    let generation = 0;
    const responses: any[] = [];
    const events: string[] = [];
    const transport = new UnrealTransportDiagnostics(async () => {});
    transport.attach(socket, 1, '127.0.0.1', 27099).editorProcessId = 123;
    const runtime = {
        cache: {
            isRefreshInProgress: () => true,
            getActiveGeneration: () => generation,
            approveAcceptedPublication: () => events.push('publish'),
        },
        readiness: { update: () => {} },
        commitLiveRefresh: async (check: () => void) => {
            await commitReady;
            check();
            generation += 1;
            return { generation, revision: 'a'.repeat(64) };
        },
        markCurrentGenerationFullReady: () => events.push('ready'),
    };
    const coordinator = createNativeTypeDatabaseCoordinator({
        connection: { sendRequest: request ?? (async () => { throw new Error('VS Code must not request a private host grant'); }) },
        writer: { write: async (value: any) => { responses.push(value); } },
        ipc: true, transport, runtime,
        scriptSnapshot: { markSemanticUnsettled() {}, markSemanticSettled: () => events.push('settled') },
        getOptions: () => ({ role, budgets: DEFAULT_LANGUAGE_SERVER_BUDGETS }),
        getSocket: () => socket, getSocketEpoch: () => 1, isStopping: () => false,
        cancelReconnect() {}, cancelRequests() {}, cancelDiagnostics() {}, onCommitted() {},
        onCommitFailure() {}, startDiagnostics() {}, resumeDiagnostics() {}, trySettle() {},
    } as unknown as Options);
    return { socket, coordinator, responses, events, commit: () => resolveCommit!() };
}

test('native mutation holds semantic messages while controls, responses, and cancellation remain live', async () => {
    const value = fixture();
    value.coordinator.commit(value.socket, 1);
    const received: string[] = [];
    const next = (message: any) => received.push(message.method ?? 'response');
    value.coordinator.handleMessage({ id: 1, method: 'textDocument/hover' }, next);
    value.coordinator.handleMessage({ method: 'textDocument/didChange' }, next);
    value.coordinator.handleMessage({ id: 2, method: 'angelscript/diagnosticsStatus' }, next);
    value.coordinator.handleMessage({ id: 3, result: null }, next);
    value.coordinator.handleMessage({ method: '$/cancelRequest', params: { id: 1 } }, next);
    assert.deepEqual(received, ['angelscript/diagnosticsStatus', 'response', '$/cancelRequest']);
    assert.equal(value.responses[0].id, 1);
    assert.equal(value.responses[0].error.code, -32800);
    value.commit();
    await turn();
    assert.deepEqual(received, ['angelscript/diagnosticsStatus', 'response', '$/cancelRequest', 'textDocument/didChange']);
    value.socket.destroy();
});

test('managed synchronization waits for matching host finish acknowledgement before ready and publication', async () => {
    let acknowledge: (value: unknown) => void;
    const calls: any[] = [];
    const value = fixture('project-daemon', async (_method, params) => {
        calls.push(params);
        return params.phase === 'begin' ? { roundId: 'native-round', remainingMs: 30000 }
            : new Promise((resolve) => { acknowledge = resolve; });
    });
    await value.coordinator.begin();
    value.coordinator.commit(value.socket, 1);
    value.commit();
    await turn();
    assert.equal(value.coordinator.settlePending(), true);
    assert.deepEqual(value.events, []);
    assert.equal(calls[1].phase, 'finish');
    acknowledge!({ completed: true });
    await turn();
    assert.deepEqual(value.events, ['ready', 'settled', 'publish']);
    value.socket.destroy();
});

test('ordinary VS Code uses one local total budget across retries and stops terminally at its deadline', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fatal = new Error('terminal child exit');
    const exit = t.mock.method(process, 'exit', () => { throw fatal; });
    t.mock.method(process.stderr, 'write', () => true);
    const value = fixture();
    await value.coordinator.begin();
    t.mock.timers.tick(20000);
    await value.coordinator.begin();
    assert.throws(() => t.mock.timers.tick(10000), (error) => error === fatal);
    assert.equal(exit.mock.calls[0].arguments[0], 78);
    assert.equal(value.coordinator.stopped, true);
    assert.throws(() => value.coordinator.checkDeadline(), { code: 'LanguageServerTypeDatabaseDeadlineExceeded' });
    assert.deepEqual(value.events, []);
});
