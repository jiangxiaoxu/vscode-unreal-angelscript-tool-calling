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
        readiness.update({ unrealConnected: true, unrealOnline: true });
        publication.cancel();
        return generation;
    }

    function markHydrationFailed(error: unknown) : void
    {
        if (preRefreshStatus && cache.getRevision())
        {
            readiness.update({ ...preRefreshStatus, generation: cache.getGeneration(), unrealConnected: true });
            preRefreshStatus = null;
            return;
        }
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
        if (!status.fullReady)
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
        if (options?.role != 'ue-resident' || !readiness.snapshot().fullReady)
            return;
        let generation = cache.getGeneration();
        publication.schedule(generation, () => {
            if (generation != cache.getGeneration() || !readiness.snapshot().fullReady)
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
        let generation = cache.getGeneration();
        let revision = cache.getRevision();
        let status = readiness.snapshot();
        if (status.generation != generation || !revision)
            return;
        readiness.update({ generation, revision, stage: 'ready', fullReady: true, coverage: 'full' });
        scheduleIndexExport();
    }

    function updateDiagnostics(uri: string, values: readonly Diagnostic[]) : void
    {
        diagnostics.update(uri, values);
    }

    function scriptGenerationChanged() : void
    {
        scheduleIndexExport();
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
        scriptGenerationChanged,
        shutdown,
        get options() { return options; },
    };
}
