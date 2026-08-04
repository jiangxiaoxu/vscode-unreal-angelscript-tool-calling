import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test = require('node:test');
import { CancellationTokenSource } from 'vscode-languageserver/node';
import {
    createProjectDaemonScriptSnapshotProtocol,
    canonicalizeScriptSnapshotPayload,
    computeScriptSnapshotPayloadHash,
    PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION,
    ScriptSnapshotChange,
} from '../scriptSnapshotProtocol';

const wireParityFixture = JSON.parse(fs.readFileSync(
    path.resolve('language-server', 'src', '__tests__', 'fixtures', 'scriptSnapshotProtocolWireParity.json'),
    'utf8',
)) as { params: Record<string, unknown>; canonical: string; payloadHash: string };

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);
const REVISION_C = 'c'.repeat(64);
const PAYLOAD_A = '1'.repeat(64);
const PAYLOAD_B = '2'.repeat(64);
const PAYLOAD_C = '3'.repeat(64);
const SCRIPT_A_URI = 'file:///tmp/Project/Script/A.as';
const SCRIPT_B_URI = 'file:///tmp/Project/Script/B.as';
const SCRIPT_A_HASH = '4'.repeat(64);
const SCRIPT_B_HASH = '5'.repeat(64);

function createProtocol(options: {
    enabled?: boolean;
    semanticGeneration?: number;
    fullReady?: boolean;
    getDiagnostics?: () => unknown;
    validateSnapshotContent?: (
        mode: 'full' | 'diff',
        manifest: readonly { uri: string; hash: string }[],
        changes: readonly ScriptSnapshotChange[],
    ) => ReadonlyMap<string, Uint8Array> | undefined;
} = {})
{
    const handlers = new Map<string, Function>();
    const accepted: Array<{
        changes: readonly ScriptSnapshotChange[];
        sequence: number;
        content: ReadonlyMap<string, Uint8Array> | undefined;
    }> = [];
    let semanticGeneration = options.semanticGeneration ?? 7;
    let fullReady = options.fullReady ?? true;
    const protocol = createProjectDaemonScriptSnapshotProtocol({
        connection: {
            onRequest(name: string, handler: Function) { handlers.set(name, handler); },
        } as any,
        serverInstanceId: 'instance-a',
        isEnabled: () => options.enabled !== false,
        getReadiness: () => ({
            generation: 3,
            semanticGeneration,
            settledSemanticGeneration: semanticGeneration,
            stage: fullReady ? 'ready' as const : 'parsing' as const,
            fullReady,
            coverage: fullReady ? 'full' as const : 'none' as const,
            unrealOnline: true,
            unrealConnected: true,
            cacheState: 'clean' as const,
            cacheDirty: false,
            persistenceAttempt: 0,
            activeRevision: 'native-revision',
        }),
        validateSnapshotUri: (uri) => uri.includes('/Script/'),
        validateSnapshotContent: options.validateSnapshotContent,
        applyAcceptedSnapshot: (changes, identity, content) => accepted.push({
            changes,
            sequence: identity.scriptSequence,
            content,
        }),
        getDiagnostics: options.getDiagnostics ?? (() => [{ uri: SCRIPT_A_URI, diagnostics: [] }]),
    });
    return {
        protocol,
        handlers,
        accepted,
        setSemanticGeneration: (value: number) => { semanticGeneration = value; },
        setFullReady: (value: boolean) => { fullReady = value; },
    };
}

function full(sequence = 1, revision = REVISION_A, payloadHash = PAYLOAD_A)
{
    const request = {
        protocolVersion: PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION,
        mode: 'full' as const,
        scriptSequence: sequence,
        scriptRevision: revision,
        payloadHash,
        manifest: [{ uri: SCRIPT_A_URI, hash: SCRIPT_A_HASH }],
    };
    return { ...request, payloadHash: computeScriptSnapshotPayloadHash(request) };
}

function diff(sequence = 2, revision = REVISION_B, payloadHash = PAYLOAD_B)
{
    const request = {
        protocolVersion: PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION,
        mode: 'diff' as const,
        scriptSequence: sequence,
        scriptRevision: revision,
        payloadHash,
        baseScriptSequence: sequence - 1,
        baseScriptRevision: sequence == 2 ? REVISION_A : REVISION_B,
        changes: [{ uri: SCRIPT_B_URI, kind: 'created' as const, hash: SCRIPT_B_HASH }],
    };
    return { ...request, payloadHash: computeScriptSnapshotPayloadHash(request) };
}

function query(sequence: number)
{
    return {
        protocolVersion: PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION,
        expectedServerInstanceId: 'instance-a',
        minimumScriptSequence: sequence,
        operation: 'angelscript/getAPI' as const,
        params: '',
    };
}

test('project-daemon snapshot protocol releases sixteen staggered query waiters at one settled sequence', async () =>
{
    const fixture = createProtocol({ fullReady: false });
    assert.equal(fixture.handlers.has('angelscript/synchronizeScriptSnapshot'), true);
    assert.equal(fixture.handlers.has('angelscript/queryAtScriptSequence'), true);
    assert.equal(fixture.handlers.has('angelscript/queryDiagnosticsAtScriptSequence'), true);

    const accepted = fixture.protocol.synchronize(full());
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.scriptSequence, 1);
    assert.equal(fixture.accepted.length, 1);
    assert.equal(fixture.accepted[0].changes.length, 1);

    const waiters: Array<Promise<any>> = [];
    for (let index = 0; index != 16; ++index)
    {
        if ((index & 3) == 0)
            await Promise.resolve();
        waiters.push(fixture.protocol.query(query(1)));
    }
    fixture.setFullReady(true);
    fixture.protocol.markSemanticSettled();
    const results = await Promise.all(waiters);
    assert.equal(results.length, 16);
    for (let result of results)
    {
        assert.equal(result.serverInstanceId, 'instance-a');
        assert.equal(result.scriptSequence, 1);
        assert.equal(result.scriptRevision, REVISION_A);
        assert.equal(result.semanticGeneration, 7);
        assert.equal(result.typeDbGeneration, 3);
        assert.equal(result.activeRevision, 'native-revision');
        assert.equal('value' in result, false);
    }
});

test('new sequence waits as a batch and preserves independent request cancellation', async () =>
{
    const fixture = createProtocol();
    fixture.protocol.synchronize(full());
    fixture.protocol.markSemanticSettled();
    fixture.setFullReady(false);
    fixture.protocol.synchronize(diff());

    const cancelled = new CancellationTokenSource();
    const cancelledWaiter = fixture.protocol.query(query(1), cancelled.token);
    const remaining = Array.from({ length: 15 }, () => fixture.protocol.query(query(1)));
    cancelled.cancel();
    await assert.rejects(cancelledWaiter, (error: any) => error.code == -32800);
    fixture.setFullReady(true);
    fixture.protocol.markSemanticSettled();
    const results = await Promise.all(remaining);
    assert.equal(results.length, 15);
    for (let result of results)
    {
        assert.equal(result.scriptSequence, 2);
        assert.equal(result.scriptRevision, REVISION_B);
    }
    cancelled.dispose();
});

test('full baseline, delta, idempotency and sequence conflict rules fail closed', () =>
{
    const fixture = createProtocol();
    assert.throws(() => fixture.protocol.synchronize(diff()), /first script snapshot/i);

    let accepted = fixture.protocol.synchronize(full());
    assert.equal(accepted.accepted, true);
    let idempotent = fixture.protocol.synchronize(full());
    assert.equal(idempotent.accepted, true);
    assert.equal(fixture.accepted.length, 1);
    assert.throws(() => fixture.protocol.synchronize(full(1, REVISION_C, PAYLOAD_C)), /conflicts/i);
    assert.throws(() => fixture.protocol.synchronize(full(3, REVISION_C, PAYLOAD_C)), /gap/i);
    const invalidBase = { ...diff(), baseScriptRevision: REVISION_C };
    invalidBase.payloadHash = computeScriptSnapshotPayloadHash(invalidBase);
    assert.throws(() => fixture.protocol.synchronize(invalidBase), /base/i);

    accepted = fixture.protocol.synchronize(diff());
    assert.equal(accepted.scriptSequence, 2);
    assert.equal(fixture.protocol.snapshot().manifest.length, 2);
    assert.throws(() => fixture.protocol.synchronize(diff(2, REVISION_C, PAYLOAD_C)), /conflicts/i);
    assert.throws(() => fixture.protocol.synchronize({ ...diff(), payloadHash: PAYLOAD_C }), /payloadHash/i);
});

test('full snapshots validate the entire manifest and pass immutable validated bytes to apply', () =>
{
    const trustedBytes = new Uint8Array([0x63, 0x6c, 0x61, 0x73, 0x73]);
    const validations: Array<{ mode: string; manifest: number; changes: number }> = [];
    const fixture = createProtocol({
        validateSnapshotContent: (mode, manifest, changes) => {
            validations.push({ mode, manifest: manifest.length, changes: changes.length });
            return new Map([[SCRIPT_A_URI, trustedBytes]]);
        },
    });
    fixture.protocol.synchronize(full());
    assert.deepEqual(validations[0], { mode: 'full', manifest: 1, changes: 1 });
    assert.equal(fixture.accepted[0].content?.get(SCRIPT_A_URI), trustedBytes);

    fixture.protocol.synchronize(full(2, REVISION_B));
    assert.deepEqual(validations[1], { mode: 'full', manifest: 1, changes: 0 });
});

test('sequence-aware API rejects bare and unknown operation names before waiting', async () =>
{
    const fixture = createProtocol();
    fixture.protocol.synchronize(full());
    await assert.rejects(
        fixture.protocol.query({
            expectedServerInstanceId: 'instance-a',
            minimumScriptSequence: 1,
            operation: 'getAPI',
            params: '',
        }),
        /unsupported sequence-aware API operation/i,
    );
});

test('executor ResponseError is a JSON-RPC failure, never a successful sequence result', async () =>
{
    const fixture = createProtocol();
    fixture.protocol.synchronize(full());
    await assert.rejects(
        fixture.protocol.query({
            expectedServerInstanceId: 'instance-a',
            minimumScriptSequence: 1,
            operation: 'angelscript/getAPISearch',
            params: { query: '' },
        }),
        (error: any) => error.code == 0 && /query/i.test(error.message),
    );
});

test('wire parity fixture hashes only canonical snapshot data, excluding transport metadata', () =>
{
    assert.equal(canonicalizeScriptSnapshotPayload(wireParityFixture.params), wireParityFixture.canonical);
    assert.equal(computeScriptSnapshotPayloadHash(wireParityFixture.params), wireParityFixture.payloadHash);
    const withoutTransportMetadata = { ...wireParityFixture.params };
    delete withoutTransportMetadata.protocolVersion;
    withoutTransportMetadata.payloadHash = 'f'.repeat(64);
    assert.equal(canonicalizeScriptSnapshotPayload(withoutTransportMetadata), wireParityFixture.canonical);
    assert.equal(computeScriptSnapshotPayloadHash(withoutTransportMetadata), wireParityFixture.payloadHash);
});

test('query provenance is served at the settled causal snapshot and diagnostics share the same contract', async () =>
{
    const fixture = createProtocol();
    fixture.protocol.synchronize(full());
    fixture.protocol.markSemanticSettled();
    const result = await fixture.protocol.query(query(1));
    assert.equal(result.scriptSequence, 1);

    const diagnostics = await fixture.protocol.queryDiagnostics({
        protocolVersion: 1,
        expectedServerInstanceId: 'instance-a',
        minimumScriptSequence: 1,
    });
    assert.equal(diagnostics.scriptSequence, 1);
    assert.deepEqual(diagnostics.result, [{ uri: SCRIPT_A_URI, diagnostics: [] }]);
    assert.equal('value' in diagnostics, false);
    await assert.rejects(
        fixture.protocol.query({ ...query(1), expectedServerInstanceId: 'replaced-instance' }),
        /instance changed/i,
    );
});

test('sequence-aware diagnostics retries once when the semantic generation changes during execution', async () =>
{
    let fixture: ReturnType<typeof createProtocol>;
    let calls = 0;
    fixture = createProtocol({
        getDiagnostics: () => {
            calls += 1;
            if (calls == 1)
                fixture.setSemanticGeneration(8);
            return [];
        },
    });
    fixture.protocol.synchronize(full());
    fixture.protocol.markSemanticSettled();
    const result = await fixture.protocol.queryDiagnostics({
        expectedServerInstanceId: 'instance-a',
        minimumScriptSequence: 1,
    });
    assert.equal(calls, 2);
    assert.equal(result.semanticGeneration, 8);
});

test('protocol remains unavailable outside the project-daemon role', () =>
{
    const fixture = createProtocol({ enabled: false });
    assert.throws(() => fixture.protocol.synchronize(full()), /unavailable/i);
});
