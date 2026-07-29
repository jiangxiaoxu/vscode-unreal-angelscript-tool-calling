import {
    Connection,
    Diagnostic,
    DocumentDiagnosticReport,
    WorkspaceDiagnosticReport,
} from 'vscode-languageserver/node';
import type { LanguageServerDiagnosticsStatus } from './languageServerReadiness';
import { createHash } from 'node:crypto';

export type WorkspaceDiagnosticsRegistry = {
    update: (uri: string, diagnostics: readonly Diagnostic[]) => void;
    clear: (uri: string) => void;
    get: (uri: string) => { uri: string; diagnostics: Diagnostic[]; contentHash: string } | undefined;
    snapshot: () => Array<{ uri: string; diagnostics: Diagnostic[]; contentHash: string }>;
};

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
    getStatus: () => LanguageServerDiagnosticsStatus
) : void
{
    let resultId = (contentHash: string, status: LanguageServerDiagnosticsStatus) =>
        `${status.generation}:${status.revision ?? 'partial'}:${contentHash}`;

    connection.languages.diagnostics.on((params) : DocumentDiagnosticReport => {
        let status = getStatus();
        let entry = registry.get(params.textDocument.uri);
        let currentResultId = resultId(entry?.contentHash ?? 'empty', status);
        if (params.previousResultId == currentResultId)
            return { kind: 'unchanged', resultId: currentResultId };
        return {
            kind: 'full',
            resultId: currentResultId,
            items: entry?.diagnostics ?? [],
        };
    });

    connection.languages.diagnostics.onWorkspace((params) : WorkspaceDiagnosticReport => {
        let status = getStatus();
        let previousByUri = new Map((params.previousResultIds ?? []).map((previous) => [previous.uri, previous.value]));
        let items = registry.snapshot().map(({ uri, diagnostics, contentHash }) => {
            let currentResultId = resultId(contentHash, status);
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
    });
}
