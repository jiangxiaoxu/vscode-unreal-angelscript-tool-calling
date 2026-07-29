import * as path from 'node:path';
import { Connection, Diagnostic } from 'vscode-languageserver/node';
import { buildApiQueryIndex, writeApiQueryIndexAtomic } from './apiQueryIndexExporter';
import { createDebouncedPublication } from './debouncedPublication';
import { ResolvedAngelScriptLanguageServerOptions } from './languageServerContract';
import { createLanguageServerReadinessController, LanguageServerDiagnosticsStatus } from './languageServerReadiness';
import { createUnrealCacheController, UnrealCacheLoadOutcome } from './unrealCacheController';
import { createWorkspaceDiagnosticsRegistry, registerWorkspaceDiagnostics } from './workspaceDiagnostics';

export type ApiQueryIndexExportResult = {
    path?: string;
    projectIdentity: string;
    debugDatabaseRevision: string;
    producerHash: string;
    scriptContentRevision: string;
    recordCount: number;
    recordsHash: string;
};

export function createLanguageServerAutomationRuntime(connection: Connection, extensionVersion: string)
{
    let options: ResolvedAngelScriptLanguageServerOptions | null = null;
    const cache = createUnrealCacheController();
    const diagnostics = createWorkspaceDiagnosticsRegistry();
    const publication = createDebouncedPublication();
    let preRefreshStatus: LanguageServerDiagnosticsStatus | null = null;
    let nativeRefreshPending = false;
    let nativeRefreshSemanticGeneration: number | null = null;
    const readiness = createLanguageServerReadinessController((status) => {
        connection.sendNotification('angelscript/diagnosticsStatus', status);
    });
    registerWorkspaceDiagnostics(connection, diagnostics, () => readiness.snapshot());
    connection.onRequest('angelscript/diagnosticsStatus', () => readiness.snapshot());

    function configure(resolvedOptions: ResolvedAngelScriptLanguageServerOptions) : UnrealCacheLoadOutcome
    {
        options = resolvedOptions;
        readiness.update({
            stage: 'loading-cache',
            unrealOnline: options.unrealOnline,
            unrealConnected: false,
        });
        cache.configure({
            cachePath: options.cachePath,
            access: options.cacheAccess,
            projectIdentity: options.projectIdentity,
            budgets: options.budgets,
            producerCompatibility: {
                extensionVersionPrefix: extensionVersion.split('.').slice(0, 2).join('.') + '.',
                ...(process.env.UNREAL_ANGELSCRIPT_LS_COMMIT
                    ? { languageServerCommit: process.env.UNREAL_ANGELSCRIPT_LS_COMMIT }
                    : {}),
            },
        }, {
            extensionVersion,
            languageServerCommit: process.env.UNREAL_ANGELSCRIPT_LS_COMMIT || 'development',
        });
        let outcome = cache.loadCacheFromDisk();
        readiness.update({
            cache: outcome.loaded ? 'loaded' : (outcome.code == 'missing' ? 'missing' : 'rejected'),
            cacheReason: outcome.message,
            revision: outcome.revision,
            stage: 'parsing',
        });
        return outcome;
    }

    function beginLiveRefresh() : number
    {
        preRefreshStatus = readiness.snapshot();
        let generation = cache.beginRefresh();
        readiness.beginRefresh(generation);
        nativeRefreshPending = true;
        nativeRefreshSemanticGeneration = readiness.snapshot().semanticGeneration;
        readiness.update({ unrealConnected: true, unrealOnline: true });
        publication.cancel();
        return generation;
    }

    function markHydrationFailed(error: unknown) : void
    {
        if (preRefreshStatus && cache.getRevision())
        {
            let currentStatus = readiness.snapshot();
            let semanticGeneration = currentStatus.semanticGeneration;
            let onlyNativeRefreshChangedSemantics = semanticGeneration == nativeRefreshSemanticGeneration;
            let priorSemanticsWereSettled = preRefreshStatus.semanticGeneration
                == preRefreshStatus.settledSemanticGeneration;
            nativeRefreshPending = false;
            nativeRefreshSemanticGeneration = null;
            if (onlyNativeRefreshChangedSemantics)
            {
                readiness.update({
                    ...preRefreshStatus,
                    generation: cache.getGeneration(),
                    semanticGeneration,
                    settledSemanticGeneration: priorSemanticsWereSettled
                        ? semanticGeneration
                        : preRefreshStatus.settledSemanticGeneration,
                    unrealConnected: true,
                });
            }
            else
            {
                readiness.update({
                    generation: cache.getGeneration(),
                    revision: cache.getRevision(),
                    cache: preRefreshStatus.cache,
                    cacheReason: preRefreshStatus.cacheReason,
                    unrealConnected: true,
                });
            }
            preRefreshStatus = null;
            return;
        }
        nativeRefreshPending = false;
        nativeRefreshSemanticGeneration = null;
        readiness.update({
            stage: 'partial',
            fullReady: false,
            coverage: 'partial',
            cache: 'rejected',
            cacheReason: `DebugDatabase hydration failed: ${String(error)}`,
            revision: undefined,
        });
    }

    function markResolving() : void
    {
        preRefreshStatus = null;
        readiness.update({ stage: 'resolving', revision: cache.getRevision() });
    }

    function exportApiQueryIndex() : ApiQueryIndexExportResult
    {
        if (!options)
            throw new Error('Language Server initialization is incomplete.');
        let status = readiness.snapshot();
        if (!status.fullReady || status.semanticGeneration != status.settledSemanticGeneration)
            throw new Error(`Language Server is not fully ready (stage=${status.stage}).`);
        let revision = cache.getRevision() ?? status.revision;
        if (!revision)
            throw new Error('Debug database revision is unavailable.');
        let producerHash = process.env.UNREAL_ANGELSCRIPT_LS_COMMIT || 'development';
        let index = buildApiQueryIndex(options.projectIdentity, revision, producerHash);
        let indexPath: string | undefined;
        if (options.cacheAccess == 'read-write')
        {
            indexPath = path.join(path.dirname(options.cachePath), 'api-query-index.v1.json.gz');
            writeApiQueryIndexAtomic(indexPath, index);
        }
        return {
            ...(indexPath ? { path: indexPath } : {}),
            projectIdentity: index.projectIdentity,
            debugDatabaseRevision: index.debugDatabaseRevision,
            producerHash: index.producerHash,
            scriptContentRevision: index.scriptContentRevision,
            recordCount: index.records.length,
            recordsHash: index.recordsHash,
        };
    }

    function scheduleIndexExport() : void
    {
        let status = readiness.snapshot();
        if (options?.role != 'ue-resident' || !status.fullReady
            || status.semanticGeneration != status.settledSemanticGeneration)
            return;
        let semanticGeneration = status.semanticGeneration;
        publication.schedule(semanticGeneration, () => {
            let current = readiness.snapshot();
            if (semanticGeneration != current.semanticGeneration || !current.fullReady
                || current.semanticGeneration != current.settledSemanticGeneration)
                return;
            try { exportApiQueryIndex(); } catch (error) { connection.console.error(`API query index export failed: ${String(error)}`); }
        });
    }

    function scheduleCacheWrite(unrealConnected: boolean) : void
    {
        cache.scheduleWrite(unrealConnected, (published) => {
            readiness.update({ cache: 'published', revision: published.revision });
            scheduleIndexExport();
        }, (error) => {
            readiness.update({ cache: 'rejected', cacheReason: `Cache publication failed: ${String(error)}` });
            connection.console.error(`Debug database cache publication failed: ${String(error)}`);
        });
    }

    function markCurrentGenerationFullReady() : void
    {
        if (nativeRefreshPending)
            return;
        let generation = cache.getGeneration();
        let revision = cache.getRevision();
        let status = readiness.snapshot();
        if (status.generation != generation || !revision)
            return;
        readiness.update({ generation, revision });
        readiness.markFullReady();
        scheduleIndexExport();
    }

    function updateDiagnostics(uri: string, values: readonly Diagnostic[]) : void
    {
        diagnostics.update(uri, values);
    }

    function beginScriptSemanticRefresh() : number
    {
        publication.cancel();
        return readiness.beginSemanticRefresh();
    }

    function completeNativeRefresh() : void
    {
        nativeRefreshPending = false;
        nativeRefreshSemanticGeneration = null;
    }

    function shutdown() : void
    {
        readiness.update({ stage: 'stopping', fullReady: false });
        cache.cancelPendingWrite();
        publication.cancel();
    }

    return {
        cache,
        readiness,
        configure,
        beginLiveRefresh,
        markHydrationFailed,
        markResolving,
        markCurrentGenerationFullReady,
        scheduleCacheWrite,
        scheduleIndexExport,
        exportApiQueryIndex,
        updateDiagnostics,
        beginScriptSemanticRefresh,
        completeNativeRefresh,
        get nativeRefreshPending() { return nativeRefreshPending; },
        shutdown,
        get options() { return options; },
    };
}
