import {
    CancellationToken,
    Connection,
    Diagnostic,
    DocumentDiagnosticReport,
    LSPErrorCodes,
    ResponseError,
    WorkspaceDiagnosticReport,
} from 'vscode-languageserver/node';
import type { LanguageServerDiagnosticsStatus } from './languageServerReadiness';
import { createHash } from 'node:crypto';
import { LANGUAGE_SERVER_TIMEOUTS_MS } from './languageServerTimeouts';
import { performance } from 'node:perf_hooks';

const DIAGNOSTICS_NOT_READY_ERROR_CODE = -32002;

export type WorkspaceDiagnosticsWaitOptions = {
    timeoutMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
    wait?: (delayMs: number, cancellationToken?: CancellationToken) => Promise<boolean>;
};

export type WorkspaceDiagnosticsRegistry = {
    update: (uri: string, diagnostics: readonly Diagnostic[]) => void;
    clear: (uri: string) => void;
    get: (uri: string) => { uri: string; diagnostics: Diagnostic[]; contentHash: string } | undefined;
    snapshot: () => Array<{ uri: string; diagnostics: Diagnostic[]; contentHash: string }>;
};

export function workspaceDiagnosticResultId(
    contentHash: string,
    status: LanguageServerDiagnosticsStatus,
) : string
{
    return `${status.generation}:${status.semanticGeneration}:${status.activeRevision ?? 'partial'}:${contentHash}`;
}

export function buildWorkspaceDiagnosticReport(
    registry: WorkspaceDiagnosticsRegistry,
    status: LanguageServerDiagnosticsStatus,
    previousResultIds: readonly { uri: string; value: string }[] = [],
) : WorkspaceDiagnosticReport
{
    let previousByUri = new Map(previousResultIds.map((previous) => [previous.uri, previous.value]));
    let items = registry.snapshot().map(({ uri, diagnostics, contentHash }) => {
        let currentResultId = workspaceDiagnosticResultId(contentHash, status);
        if (previousByUri.get(uri) == currentResultId)
        {
            return {
                kind: 'unchanged' as const,
                uri,
                version: null as number | null,
                resultId: currentResultId,
            };
        }
        return {
            kind: 'full' as const,
            uri,
            version: null as number | null,
            items: diagnostics,
            resultId: currentResultId,
        };
    });
    return { items };
}

export function createWorkspaceDiagnosticsRegistry() : WorkspaceDiagnosticsRegistry
{
    let diagnosticsByUri = new Map<string, { diagnostics: Diagnostic[]; contentHash: string }>();
    return {
        update(uri, diagnostics)
        {
            let copied = diagnostics.map((diagnostic) => ({ ...diagnostic }));
            diagnosticsByUri.set(uri, {
                diagnostics: copied,
                contentHash: createHash('sha256').update(JSON.stringify(copied)).digest('hex'),
            });
        },
        clear(uri)
        {
            diagnosticsByUri.delete(uri);
        },
        get(uri)
        {
            let entry = diagnosticsByUri.get(uri);
            return entry ? { uri, diagnostics: entry.diagnostics.map((diagnostic) => ({ ...diagnostic })), contentHash: entry.contentHash } : undefined;
        },
        snapshot()
        {
            return Array.from(diagnosticsByUri.entries())
                .map(([uri, entry]) => ({
                    uri,
                    diagnostics: entry.diagnostics.map((diagnostic) => ({ ...diagnostic })),
                    contentHash: entry.contentHash,
                }))
                .sort((left, right) => left.uri.localeCompare(right.uri));
        }
    };
}

export function registerWorkspaceDiagnostics(
    connection: Connection,
    registry: WorkspaceDiagnosticsRegistry,
    getStatus: () => LanguageServerDiagnosticsStatus,
    waitOptions: WorkspaceDiagnosticsWaitOptions = {},
) : void
{
    connection.languages.diagnostics.on(async (params, cancellationToken) : Promise<DocumentDiagnosticReport> => {
        let status = await waitForSettledDiagnosticsStatus(getStatus, cancellationToken, waitOptions);
        let entry = registry.get(params.textDocument.uri);
        let currentResultId = workspaceDiagnosticResultId(entry?.contentHash ?? 'empty', status);
        if (params.previousResultId == currentResultId)
            return { kind: 'unchanged', resultId: currentResultId };
        return {
            kind: 'full',
            resultId: currentResultId,
            items: entry?.diagnostics ?? [],
        };
    });

    connection.languages.diagnostics.onWorkspace(async (params, cancellationToken) : Promise<WorkspaceDiagnosticReport> => {
        let status = await waitForSettledDiagnosticsStatus(getStatus, cancellationToken, waitOptions);
        return buildWorkspaceDiagnosticReport(registry, status, params.previousResultIds ?? []);
    });
}

export async function waitForSettledDiagnosticsStatus(
    getStatus: () => LanguageServerDiagnosticsStatus,
    cancellationToken?: CancellationToken,
    options: WorkspaceDiagnosticsWaitOptions = {},
) : Promise<LanguageServerDiagnosticsStatus>
{
    let timeoutMs = options.timeoutMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.workspaceDiagnosticsSettle;
    let pollIntervalMs = options.pollIntervalMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.workspaceDiagnosticsPoll;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
        throw new Error('Workspace diagnostics settle timeout must be a non-negative finite number.');
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0)
        throw new Error('Workspace diagnostics poll interval must be a positive finite number.');
    let now = options.now ?? (() => performance.now());
    let wait = options.wait ?? waitForDelayOrCancellation;
    if (cancellationToken?.isCancellationRequested)
    {
        throw new ResponseError<void>(
            LSPErrorCodes.RequestCancelled,
            'Workspace diagnostics request was cancelled while waiting for a settled semantic generation.',
        );
    }
    let status = getStatus();
    if (status.semanticGeneration == status.settledSemanticGeneration
        && status.stage != 'loading-cache'
        && status.stage != 'parsing'
        && status.stage != 'resolving')
        return status;
    let deadline = now() + timeoutMs;
    while (true)
    {
        if (cancellationToken?.isCancellationRequested)
        {
            throw new ResponseError<void>(
                LSPErrorCodes.RequestCancelled,
                'Workspace diagnostics request was cancelled while waiting for a settled semantic generation.',
            );
        }
        let remainingMs = deadline - now();
        if (remainingMs <= 0)
        {
            throw new ResponseError<void>(
                DIAGNOSTICS_NOT_READY_ERROR_CODE,
                `NotReady: workspace diagnostics did not settle within ${timeoutMs}ms; stage=${status.stage}, generation=${status.semanticGeneration}, settledGeneration=${status.settledSemanticGeneration}.`,
            );
        }
        status = getStatus();
        if (status.semanticGeneration == status.settledSemanticGeneration
            && status.stage != 'loading-cache'
            && status.stage != 'parsing'
            && status.stage != 'resolving')
            return status;
        if (!await wait(Math.min(pollIntervalMs, remainingMs), cancellationToken))
        {
            throw new ResponseError<void>(
                LSPErrorCodes.RequestCancelled,
                'Workspace diagnostics request was cancelled while waiting for a settled semantic generation.',
            );
        }
    }
}

function waitForDelayOrCancellation(delayMs: number, cancellationToken?: CancellationToken) : Promise<boolean>
{
    if (cancellationToken?.isCancellationRequested)
        return Promise.resolve(false);
    return new Promise((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | null = setTimeout(() => finish(true), delayMs);
        let cancellation = cancellationToken?.onCancellationRequested(() => finish(false));
        function finish(elapsed: boolean) : void
        {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            timer = null;
            cancellation?.dispose();
            resolve(elapsed);
        }
        if (cancellationToken?.isCancellationRequested)
            finish(false);
    });
}
