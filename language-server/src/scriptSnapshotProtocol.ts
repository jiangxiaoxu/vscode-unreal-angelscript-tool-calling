import { CancellationToken, Connection, LSPErrorCodes, ResponseError } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ApiReadOperation, executeApiReadOperation, isApiReadOperation } from './apiReadExecutor';
import { LanguageServerDiagnosticsStatus } from './languageServerReadiness';
import {
    createScriptSnapshotSequenceController,
    ScriptSnapshotIdentity,
    ScriptSnapshotSequenceController,
} from './scriptSnapshotSequence';

export const PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION = 1;
const SCRIPT_SNAPSHOT_PROTOCOL_ERROR_CODE = -32020;
const SCRIPT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type ScriptSnapshotManifestEntry = {
    uri: string;
    hash: string;
};

export type ScriptSnapshotChange = {
    uri: string;
    kind: 'created' | 'changed' | 'deleted';
    hash?: string;
};

export type SynchronizeScriptSnapshotParams = {
    protocolVersion?: number;
    mode: 'full' | 'diff';
    scriptSequence: number;
    scriptRevision: string;
    payloadHash: string;
    manifest?: ScriptSnapshotManifestEntry[];
    baseScriptSequence?: number;
    baseScriptRevision?: string;
    changes?: ScriptSnapshotChange[];
};

export type QueryAtScriptSequenceParams = {
    protocolVersion?: number;
    expectedServerInstanceId: string;
    minimumScriptSequence: number;
    operation: ApiReadOperation;
    params: unknown;
};

export type QueryDiagnosticsAtScriptSequenceParams = {
    protocolVersion?: number;
    expectedServerInstanceId: string;
    minimumScriptSequence: number;
};

export type ScriptSnapshotProvenance = {
    serverInstanceId: string;
    scriptSequence: number;
    scriptRevision: string;
    semanticGeneration: number;
    typeDbGeneration: number;
    activeRevision?: string;
};

export type SynchronizeScriptSnapshotResult = {
    accepted: true;
    serverInstanceId: string;
    scriptSequence: number;
    scriptRevision: string;
};

export type QueryAtScriptSequenceResult = ScriptSnapshotProvenance & {
    result: unknown;
};

export type QueryDiagnosticsAtScriptSequenceResult = ScriptSnapshotProvenance & {
    result: unknown;
};

export type ValidatedScriptSnapshotContent = ReadonlyMap<string, Uint8Array>;

export type ProjectDaemonScriptSnapshotProtocolDeps = {
    connection: Connection;
    serverInstanceId: string;
    isEnabled: () => boolean;
    getReadiness: () => LanguageServerDiagnosticsStatus;
    validateSnapshotUri?: (uri: string) => boolean;
    validateSnapshotContent?: (
        mode: 'full' | 'diff',
        manifest: readonly ScriptSnapshotManifestEntry[],
        changes: readonly ScriptSnapshotChange[],
        identity: ScriptSnapshotIdentity,
    ) => ValidatedScriptSnapshotContent | undefined;
    applyAcceptedSnapshot: (
        changes: readonly ScriptSnapshotChange[],
        identity: ScriptSnapshotIdentity,
        content: ValidatedScriptSnapshotContent | undefined,
    ) => void;
    getDiagnostics: () => unknown;
};

export type ProjectDaemonScriptSnapshotProtocol = {
    synchronize: (params: unknown) => SynchronizeScriptSnapshotResult;
    query: (params: unknown, cancellationToken?: CancellationToken) => Promise<QueryAtScriptSequenceResult>;
    queryDiagnostics: (params: unknown, cancellationToken?: CancellationToken) => Promise<QueryDiagnosticsAtScriptSequenceResult>;
    markSemanticSettled: () => void;
    markSemanticUnsettled: () => void;
    snapshot: () => {
        accepted?: ScriptSnapshotIdentity;
        settled?: ScriptSnapshotIdentity;
        manifest: ScriptSnapshotManifestEntry[];
    };
    shutdown: () => void;
};

type NormalizedSnapshot = {
    mode: 'full' | 'diff';
    identity: ScriptSnapshotIdentity;
    payloadHash: string;
    manifest?: Map<string, ScriptSnapshotManifestEntry>;
    base?: ScriptSnapshotIdentity;
    changes?: ScriptSnapshotChange[];
};

function isRecord(value: unknown) : value is Record<string, unknown>
{
    return !!value && typeof value == 'object' && !Array.isArray(value);
}

function protocolError(message: string) : ResponseError<void>
{
    return new ResponseError<void>(SCRIPT_SNAPSHOT_PROTOCOL_ERROR_CODE, message);
}

function requiredPositiveInteger(value: unknown, name: string) : number
{
    if (!Number.isSafeInteger(value) || (value as number) <= 0)
        throw protocolError(`${name} must be a positive safe integer.`);
    return value as number;
}

function requiredHash(value: unknown, name: string) : string
{
    if (typeof value != 'string' || !SCRIPT_HASH_PATTERN.test(value))
        throw protocolError(`${name} must be a lower-case SHA-256 hex digest.`);
    return value;
}

function normalizeFileUri(value: unknown) : string
{
    if (typeof value != 'string' || value.length == 0)
        throw protocolError('Snapshot URI must be a non-empty file URI.');
    let uri: URI;
    try { uri = URI.parse(value, true); }
    catch { throw protocolError(`Snapshot URI is invalid: ${value}`); }
    if (uri.scheme != 'file' || !uri.fsPath)
        throw protocolError(`Snapshot URI must use the file scheme: ${value}`);
    return URI.file(path.resolve(uri.fsPath)).toString();
}

function normalizeManifest(value: unknown) : Map<string, ScriptSnapshotManifestEntry>
{
    if (!Array.isArray(value))
        throw protocolError('Full script snapshot requires a manifest array.');
    let manifest = new Map<string, ScriptSnapshotManifestEntry>();
    for (let entry of value)
    {
        if (!isRecord(entry))
            throw protocolError('Script snapshot manifest entry must be an object.');
        let uri = normalizeFileUri(entry.uri);
        let hash = requiredHash(entry.hash, `Manifest hash for ${uri}`);
        if (manifest.has(uri))
            throw protocolError(`Script snapshot manifest contains duplicate URI ${uri}.`);
        manifest.set(uri, { uri, hash });
    }
    return manifest;
}

function normalizeChanges(value: unknown) : ScriptSnapshotChange[]
{
    if (!Array.isArray(value))
        throw protocolError('Diff script snapshot requires a changes array.');
    let changes: ScriptSnapshotChange[] = [];
    let seenUris = new Set<string>();
    for (let entry of value)
    {
        if (!isRecord(entry))
            throw protocolError('Script snapshot change must be an object.');
        let uri = normalizeFileUri(entry.uri);
        if (seenUris.has(uri))
            throw protocolError(`Script snapshot diff contains duplicate URI ${uri}.`);
        seenUris.add(uri);
        let rawKind = entry.kind;
        if (rawKind != 'created' && rawKind != 'changed' && rawKind != 'deleted')
            throw protocolError(`Script snapshot change kind for ${uri} is invalid.`);
        let kind = rawKind as ScriptSnapshotChange['kind'];
        if (kind == 'deleted')
        {
            if (entry.hash !== undefined)
                throw protocolError(`Deleted script snapshot change ${uri} must not carry a hash.`);
            changes.push({ uri, kind: 'deleted' });
            continue;
        }
        changes.push({
            uri,
            kind,
            hash: requiredHash(entry.hash, `Snapshot change hash for ${uri}`),
        });
    }
    return changes;
}

function normalizeSynchronizationParams(value: unknown) : NormalizedSnapshot
{
    if (!isRecord(value))
        throw protocolError('Script snapshot synchronization params must be an object.');
    if (value.protocolVersion !== undefined && value.protocolVersion != PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION)
        throw protocolError(`Unsupported project-daemon script snapshot protocol version ${String(value.protocolVersion)}.`);
    if (value.mode != 'full' && value.mode != 'diff')
        throw protocolError("Script snapshot mode must be 'full' or 'diff'.");
    let identity = {
        scriptSequence: requiredPositiveInteger(value.scriptSequence, 'scriptSequence'),
        scriptRevision: requiredHash(value.scriptRevision, 'scriptRevision'),
    };
    let payloadHash = requiredHash(value.payloadHash, 'payloadHash');
    if (value.mode == 'full')
    {
        if (value.baseScriptSequence !== undefined || value.baseScriptRevision !== undefined || value.changes !== undefined)
            throw protocolError('Full script snapshot must not include diff base or changes fields.');
        return { mode: 'full', identity, payloadHash, manifest: normalizeManifest(value.manifest) };
    }
    if (value.manifest !== undefined)
        throw protocolError('Diff script snapshot must not include a manifest.');
    return {
        mode: 'diff',
        identity,
        payloadHash,
        base: {
            scriptSequence: requiredPositiveInteger(value.baseScriptSequence, 'baseScriptSequence'),
            scriptRevision: requiredHash(value.baseScriptRevision, 'baseScriptRevision'),
        },
        changes: normalizeChanges(value.changes),
    };
}

function canonicalSnapshotPayload(request: NormalizedSnapshot) : string
{
    if (request.mode == 'full')
    {
        return JSON.stringify({
            mode: request.mode,
            scriptSequence: request.identity.scriptSequence,
            scriptRevision: request.identity.scriptRevision,
            manifest: Array.from(request.manifest!.values())
                .sort((left, right) => left.uri.localeCompare(right.uri))
                .map(({ uri, hash }) => ({ uri, hash })),
        });
    }
    return JSON.stringify({
        mode: request.mode,
        scriptSequence: request.identity.scriptSequence,
        scriptRevision: request.identity.scriptRevision,
        baseScriptSequence: request.base!.scriptSequence,
        baseScriptRevision: request.base!.scriptRevision,
        changes: request.changes!
            .slice()
            .sort((left, right) => left.uri.localeCompare(right.uri))
            .map((change) => change.kind == 'deleted'
                ? { uri: change.uri, kind: change.kind }
                : { uri: change.uri, kind: change.kind, hash: change.hash }),
    });
}

export function canonicalizeScriptSnapshotPayload(params: unknown) : string
{
    let normalized = normalizeSynchronizationParams(params);
    return canonicalSnapshotPayload(normalized);
}

export function computeScriptSnapshotPayloadHash(params: unknown) : string
{
    return createHash('sha256').update(canonicalizeScriptSnapshotPayload(params), 'utf8').digest('hex');
}

function normalizeQueryParams(value: unknown) : QueryAtScriptSequenceParams
{
    if (!isRecord(value))
        throw protocolError('Sequence-aware API query params must be an object.');
    if (value.protocolVersion !== undefined && value.protocolVersion != PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION)
        throw protocolError(`Unsupported project-daemon script snapshot protocol version ${String(value.protocolVersion)}.`);
    if (typeof value.expectedServerInstanceId != 'string' || value.expectedServerInstanceId.length == 0)
        throw protocolError('expectedServerInstanceId must be a non-empty string.');
    if (!isApiReadOperation(value.operation))
        throw protocolError(`Unsupported sequence-aware API operation ${String(value.operation)}.`);
    return {
        expectedServerInstanceId: value.expectedServerInstanceId,
        minimumScriptSequence: requiredPositiveInteger(value.minimumScriptSequence, 'minimumScriptSequence'),
        operation: value.operation,
        params: value.params,
    };
}

function normalizeDiagnosticsParams(value: unknown) : QueryDiagnosticsAtScriptSequenceParams
{
    if (!isRecord(value))
        throw protocolError('Sequence-aware diagnostics query params must be an object.');
    if (value.protocolVersion !== undefined && value.protocolVersion != PROJECT_DAEMON_SCRIPT_SNAPSHOT_PROTOCOL_VERSION)
        throw protocolError(`Unsupported project-daemon script snapshot protocol version ${String(value.protocolVersion)}.`);
    if (typeof value.expectedServerInstanceId != 'string' || value.expectedServerInstanceId.length == 0)
        throw protocolError('expectedServerInstanceId must be a non-empty string.');
    return {
        expectedServerInstanceId: value.expectedServerInstanceId,
        minimumScriptSequence: requiredPositiveInteger(value.minimumScriptSequence, 'minimumScriptSequence'),
    };
}

function copyManifest(manifest: Map<string, ScriptSnapshotManifestEntry>) : Map<string, ScriptSnapshotManifestEntry>
{
    return new Map(Array.from(manifest, ([uri, entry]) => [uri, { ...entry }]));
}

function manifestChanges(
    previous: Map<string, ScriptSnapshotManifestEntry>,
    next: Map<string, ScriptSnapshotManifestEntry>,
) : ScriptSnapshotChange[]
{
    let changes: ScriptSnapshotChange[] = [];
    for (let [uri, entry] of next)
    {
        let before = previous.get(uri);
        if (!before)
            changes.push({ uri, kind: 'created', hash: entry.hash });
        else if (before.hash != entry.hash)
            changes.push({ uri, kind: 'changed', hash: entry.hash });
    }
    for (let uri of previous.keys())
    {
        if (!next.has(uri))
            changes.push({ uri, kind: 'deleted' });
    }
    return changes.sort((left, right) => left.uri.localeCompare(right.uri));
}

function applyDiff(
    previous: Map<string, ScriptSnapshotManifestEntry>,
    changes: readonly ScriptSnapshotChange[],
) : Map<string, ScriptSnapshotManifestEntry>
{
    let next = copyManifest(previous);
    for (let change of changes)
    {
        let existing = next.get(change.uri);
        if (change.kind == 'created')
        {
            if (existing)
                throw protocolError(`Created script snapshot change already exists: ${change.uri}.`);
            next.set(change.uri, { uri: change.uri, hash: change.hash! });
        }
        else if (change.kind == 'changed')
        {
            if (!existing)
                throw protocolError(`Changed script snapshot change has no baseline entry: ${change.uri}.`);
            next.set(change.uri, { uri: change.uri, hash: change.hash! });
        }
        else
        {
            if (!existing)
                throw protocolError(`Deleted script snapshot change has no baseline entry: ${change.uri}.`);
            next.delete(change.uri);
        }
    }
    return next;
}

function toProvenance(
    serverInstanceId: string,
    identity: ScriptSnapshotIdentity,
    status: LanguageServerDiagnosticsStatus,
) : ScriptSnapshotProvenance
{
    return {
        serverInstanceId,
        scriptSequence: identity.scriptSequence,
        scriptRevision: identity.scriptRevision,
        semanticGeneration: status.semanticGeneration,
        typeDbGeneration: status.generation,
        ...(status.activeRevision ? { activeRevision: status.activeRevision } : {}),
    };
}

export function createProjectDaemonScriptSnapshotProtocol(
    deps: ProjectDaemonScriptSnapshotProtocolDeps,
) : ProjectDaemonScriptSnapshotProtocol
{
    const sequence: ScriptSnapshotSequenceController = createScriptSnapshotSequenceController();
    let manifest = new Map<string, ScriptSnapshotManifestEntry>();
    let acceptedPayloadHash: string | undefined;

    function ensureEnabled() : void
    {
        if (!deps.isEnabled())
            throw protocolError('Project-daemon script snapshot protocol is unavailable for this Language Server role.');
    }

    function ensureExpectedInstance(expectedServerInstanceId: string) : void
    {
        if (expectedServerInstanceId != deps.serverInstanceId)
        {
            throw protocolError(
                `Language Server instance changed: expected ${expectedServerInstanceId}, current ${deps.serverInstanceId}.`,
            );
        }
    }

    function synchronize(params: unknown) : SynchronizeScriptSnapshotResult
    {
        ensureEnabled();
        let request = normalizeSynchronizationParams(params);
        let computedPayloadHash = createHash('sha256')
            .update(canonicalSnapshotPayload(request), 'utf8')
            .digest('hex');
        if (request.payloadHash != computedPayloadHash)
            throw protocolError('payloadHash does not match the canonical script snapshot payload.');
        let current = sequence.snapshot().accepted;
        if (!current)
        {
            if (request.mode != 'full')
                throw protocolError('The first script snapshot accepted by a Language Server instance must be a full baseline.');
        }
        else if (request.identity.scriptSequence == current.scriptSequence)
        {
            if (request.identity.scriptRevision == current.scriptRevision && request.payloadHash == acceptedPayloadHash)
            {
                return {
                    accepted: true,
                    serverInstanceId: deps.serverInstanceId,
                    scriptSequence: current.scriptSequence,
                    scriptRevision: current.scriptRevision,
                };
            }
            throw protocolError(`Script snapshot sequence ${request.identity.scriptSequence} conflicts with the accepted payload.`);
        }
        else
        {
            if (request.identity.scriptSequence <= current.scriptSequence)
                throw protocolError(`Script snapshot sequence cannot move backwards from ${current.scriptSequence}.`);
            if (request.identity.scriptSequence != current.scriptSequence + 1)
                throw protocolError(`Script snapshot sequence gap: expected ${current.scriptSequence + 1}, received ${request.identity.scriptSequence}.`);
            if (request.mode == 'diff'
                && (request.base!.scriptSequence != current.scriptSequence
                    || request.base!.scriptRevision != current.scriptRevision))
            {
                throw protocolError('Diff script snapshot base does not match the accepted snapshot.');
            }
        }

        let nextManifest: Map<string, ScriptSnapshotManifestEntry>;
        let changes: ScriptSnapshotChange[];
        if (request.mode == 'full')
        {
            nextManifest = copyManifest(request.manifest!);
            changes = manifestChanges(manifest, nextManifest);
            if (!current)
                changes = Array.from(nextManifest.values())
                    .map((entry) => ({ uri: entry.uri, kind: 'created' as const, hash: entry.hash }));
        }
        else
        {
            changes = request.changes!;
            nextManifest = applyDiff(manifest, changes);
        }

        for (let change of changes)
        {
            if (deps.validateSnapshotUri && !deps.validateSnapshotUri(change.uri))
                throw protocolError(`Script snapshot URI is outside the configured Script roots: ${change.uri}`);
        }
        let validatedContent = deps.validateSnapshotContent?.(
            request.mode,
            Array.from(nextManifest.values()),
            changes,
            request.identity,
        );

        deps.applyAcceptedSnapshot(changes, request.identity, validatedContent);
        sequence.accept(request.identity);
        manifest = nextManifest;
        acceptedPayloadHash = request.payloadHash;
        if (deps.getReadiness().fullReady)
            sequence.markSettled();
        return {
            accepted: true,
            serverInstanceId: deps.serverInstanceId,
            scriptSequence: request.identity.scriptSequence,
            scriptRevision: request.identity.scriptRevision,
        };
    }

    async function runAtSequence<T>(
        expectedServerInstanceId: string,
        minimumScriptSequence: number,
        cancellationToken: CancellationToken | undefined,
        run: () => T,
    ) : Promise<ScriptSnapshotProvenance & { value: T }>
    {
        ensureEnabled();
        ensureExpectedInstance(expectedServerInstanceId);
        for (let attempt = 0; attempt != 2; ++attempt)
        {
            let identity = await sequence.waitForSettled(minimumScriptSequence, cancellationToken);
            if (cancellationToken?.isCancellationRequested)
            {
                throw new ResponseError<void>(
                    LSPErrorCodes.RequestCancelled,
                    'Sequence-aware Language Server request was cancelled before execution.',
                );
            }
            let before = deps.getReadiness();
            if (!before.fullReady)
            {
                if (attempt == 0)
                    continue;
                throw protocolError('Language Server semantic generation changed before the sequence-aware query could execute.');
            }
            let value = run();
            let after = deps.getReadiness();
            let current = sequence.snapshot();
            if (after.fullReady
                && before.semanticGeneration == after.semanticGeneration
                && current.settled?.scriptSequence >= identity.scriptSequence)
            {
                return { ...toProvenance(deps.serverInstanceId, identity, after), value };
            }
        }
        throw protocolError('Language Server semantic generation changed during a sequence-aware query.');
    }

    function registerHandlers() : void
    {
        deps.connection.onRequest('angelscript/synchronizeScriptSnapshot', (params: unknown) => synchronize(params));
        deps.connection.onRequest('angelscript/queryAtScriptSequence', async (params: unknown, cancellationToken) => {
            let request = normalizeQueryParams(params);
            let response = await runAtSequence(
                request.expectedServerInstanceId,
                request.minimumScriptSequence,
                cancellationToken,
                () => executeApiReadOperation(request.operation, request.params),
            );
            let { value, ...provenance } = response;
            return { ...provenance, result: value } as QueryAtScriptSequenceResult;
        });
        deps.connection.onRequest('angelscript/queryDiagnosticsAtScriptSequence', async (params: unknown, cancellationToken) => {
            let request = normalizeDiagnosticsParams(params);
            let response = await runAtSequence(
                request.expectedServerInstanceId,
                request.minimumScriptSequence,
                cancellationToken,
                () => deps.getDiagnostics(),
            );
            let { value, ...provenance } = response;
            return { ...provenance, result: value } as QueryDiagnosticsAtScriptSequenceResult;
        });
    }

    registerHandlers();
    return {
        synchronize,
        async query(params, cancellationToken)
        {
            let request = normalizeQueryParams(params);
            let response = await runAtSequence(
                request.expectedServerInstanceId,
                request.minimumScriptSequence,
                cancellationToken,
                () => executeApiReadOperation(request.operation, request.params),
            );
            let { value, ...provenance } = response;
            return { ...provenance, result: value };
        },
        async queryDiagnostics(params, cancellationToken)
        {
            let request = normalizeDiagnosticsParams(params);
            let response = await runAtSequence(
                request.expectedServerInstanceId,
                request.minimumScriptSequence,
                cancellationToken,
                () => deps.getDiagnostics(),
            );
            let { value, ...provenance } = response;
            return { ...provenance, result: value };
        },
        markSemanticSettled()
        {
            sequence.markSettled();
        },
        markSemanticUnsettled()
        {
            sequence.markUnsettled();
        },
        snapshot()
        {
            let state = sequence.snapshot();
            return {
                ...(state.accepted ? { accepted: state.accepted } : {}),
                ...(state.settled ? { settled: state.settled } : {}),
                manifest: Array.from(manifest.values()).map((entry) => ({ ...entry })).sort((a, b) => a.uri.localeCompare(b.uri)),
            };
        },
        shutdown()
        {
            sequence.shutdown();
        },
    };
}
