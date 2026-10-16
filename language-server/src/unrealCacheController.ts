import * as scriptfiles from './as_parser';
import * as typedb from './database';
import * as scriptlenses from './code_lenses';
import * as api_search from './api_search';
import {
    DebugDatabaseCacheContext,
    DebugDatabaseCachePayload,
    DebugDatabaseCacheProducer,
    DebugDatabaseCacheV2,
    createDebugDatabaseRevision,
    loadDebugDatabaseCacheV2,
    saveDebugDatabaseCacheV2Async,
} from './debugDatabaseCacheV2';
import {
    DebugDatabaseCachePublication,
    DebugDatabasePersistenceStatus,
    createDebugDatabaseCachePublisher,
} from './debugDatabaseCachePublisher';
import {
    hydrateTypeDatabaseGeneration,
} from './typeDatabaseGeneration';
import {
    hydrateTypeDatabaseGenerationCooperatively,
    resetTypeDatabaseCooperatively,
    resolveAllScriptModulesCooperatively,
} from './typeDatabaseCooperativeGeneration';
import {
    DebugDatabaseAccessChunk,
    normalizeDebugDatabaseAccessChunk,
} from './accessContract';

type CachedScriptSettings = {
    floatIsFloat64 : boolean;
    useAngelscriptHaze : boolean;
    deprecateStaticClass : boolean;
    disallowStaticClass : boolean;
    exposeGlobalFunctions : boolean;
    deprecateActorGenerics : boolean;
    disallowActorGenerics : boolean;
};

type AcceptedDebugDatabaseGeneration = {
    generation: number;
    chunks: unknown[];
    accessChunks: DebugDatabaseAccessChunk[];
    scriptSettings: CachedScriptSettings;
    engineSupportsCreateBlueprint: boolean;
    revision: string;
    accessState: 'base-only' | 'base+access';
};

export type DebugDatabaseAccessReadiness = 'base-only' | 'pending' | 'complete' | 'failed';

export type UnrealCacheLoadOutcome = {
    loaded: boolean;
    code: string;
    message: string;
    revision?: string;
};

export type UnrealCacheControllerOptions = {
    publishCache?: (
        context: DebugDatabaseCacheContext,
        payload: DebugDatabaseCachePayload,
        shouldCommit: () => boolean,
    ) => Promise<DebugDatabaseCacheV2>;
    publisherRetryDelaysMs?: readonly number[];
    onPersistenceStatus?: (status: DebugDatabasePersistenceStatus) => void;
    onPublished?: (cache: DebugDatabaseCacheV2) => void;
    onDiagnostic?: (event: string, data: Record<string, unknown>) => void;
};

export type UnrealCacheController = {
    configure: (context: DebugDatabaseCacheContext, producer: DebugDatabaseCacheProducer) => void;
    beginRefresh: () => number;
    abortRefresh: () => boolean;
    isRefreshInProgress: () => boolean;
    hasAcceptedGeneration: () => boolean;
    recordDebugDatabaseChunk: (chunk: unknown) => void;
    recordDebugDatabaseAccessChunk: (chunk: unknown) => void;
    setDebugDatabaseAccessExpected: (expected: boolean) => void;
    finishDebugDatabaseAccess: () => void;
    discardDebugDatabaseAccessChunks: () => void;
    getDebugDatabaseAccessReadiness: () => DebugDatabaseAccessReadiness;
    recordDebugDatabaseSettings: (settings: Partial<CachedScriptSettings>, engineSupportsCreateBlueprint: boolean, accessExpected?: boolean) => void;
    acceptCompleteCandidate: (check?: () => void, recoveryCheck?: () => void) => Promise<{ generation: number; revision: string }>;
    approveAcceptedPublication: (generation: number) => void;
    invalidateSearchCache: () => void;
    loadCacheFromDisk: () => UnrealCacheLoadOutcome;
    getActiveRevision: () => string | undefined;
    getActiveGeneration: () => number | undefined;
    getGeneration: () => number;
    getPersistenceStatus: () => DebugDatabasePersistenceStatus;
    flushPersistence: (timeoutMs?: number) => Promise<boolean>;
    shutdownPersistence: (timeoutMs?: number) => Promise<boolean>;
};

function immutableJsonClone<T>(value: T) : T
{
    return JSON.parse(JSON.stringify(value)) as T;
}

export function createUnrealCacheController(
    options: UnrealCacheControllerOptions = {},
) : UnrealCacheController
{
    let pendingDebugDatabaseChunks : Array<unknown> = [];
    let pendingDebugDatabaseAccessChunks : DebugDatabaseAccessChunk[] = [];
    let pendingDebugDatabaseAccessRecordCount = 0;
    let pendingAccessReadiness : DebugDatabaseAccessReadiness = 'base-only';
    let cacheContext : DebugDatabaseCacheContext | null = null;
    let cacheProducer : DebugDatabaseCacheProducer = {
        extensionVersion: 'development',
        languageServerCommit: 'unknown',
    };
    let acceptedGeneration: AcceptedDebugDatabaseGeneration | null = null;
    let pendingPublication: { accepted: AcceptedDebugDatabaseGeneration; task: DebugDatabaseCachePublication } | null = null;
    let generation = 0;
    let refreshInProgress = false;
    let pendingScriptSettings: CachedScriptSettings | null = null;
    let pendingEngineSupportsCreateBlueprint: boolean | null = null;
    let publisher = createDebugDatabaseCachePublisher({
        retryDelaysMs: options.publisherRetryDelaysMs,
        onStatus: options.onPersistenceStatus,
        onPublished: options.onPublished,
    });

    function configure(context: DebugDatabaseCacheContext, producer: DebugDatabaseCacheProducer) : void
    {
        cacheContext = { ...context, budgets: { ...context.budgets } };
        cacheProducer = { ...producer };
        publisher.setInitialState(context.access == 'disabled' ? 'disabled' : 'missing');
    }

    function getCurrentScriptSettings() : CachedScriptSettings
    {
        let scriptSettings = scriptfiles.GetScriptSettings();
        return {
            floatIsFloat64: scriptSettings.floatIsFloat64,
            useAngelscriptHaze: scriptSettings.useAngelscriptHaze,
            deprecateStaticClass: scriptSettings.deprecateStaticClass,
            disallowStaticClass: scriptSettings.disallowStaticClass,
            exposeGlobalFunctions: scriptSettings.exposeGlobalFunctions,
            deprecateActorGenerics: scriptSettings.deprecateActorGenerics,
            disallowActorGenerics: scriptSettings.disallowActorGenerics,
        };
    }

    function applyCachedScriptSettings(settings: Record<string, boolean>, engineSupportsCreateBlueprint: boolean) : void
    {
        let scriptSettings = scriptfiles.GetScriptSettings();
        for (let key of Object.keys(settings) as Array<keyof CachedScriptSettings>)
        {
            if (typeof settings[key] == 'boolean' && key in scriptSettings)
                (scriptSettings as unknown as Record<string, boolean>)[key] = settings[key];
        }
        scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint = engineSupportsCreateBlueprint;
    }

    function beginRefresh() : number
    {
        generation += 1;
        pendingDebugDatabaseChunks = [];
        pendingDebugDatabaseAccessChunks = [];
        pendingDebugDatabaseAccessRecordCount = 0;
        pendingAccessReadiness = 'base-only';
        pendingScriptSettings = acceptedGeneration?.scriptSettings ?? getCurrentScriptSettings();
        pendingEngineSupportsCreateBlueprint = acceptedGeneration?.engineSupportsCreateBlueprint
            ?? scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint;
        refreshInProgress = true;
        return generation;
    }

    function recordDebugDatabaseChunk(chunk: unknown) : void
    {
        if (refreshInProgress)
            pendingDebugDatabaseChunks.push(chunk);
    }

    function recordDebugDatabaseAccessChunk(chunk: unknown) : void
    {
        if (!refreshInProgress || pendingAccessReadiness != 'pending')
            return;
        let normalized = normalizeDebugDatabaseAccessChunk(chunk);
        pendingDebugDatabaseAccessChunks.push(normalized);
        pendingDebugDatabaseAccessRecordCount += (normalized.properties?.length ?? 0)
            + (normalized.methods?.length ?? 0);
    }

    function setDebugDatabaseAccessExpected(expected: boolean) : void
    {
        if (!refreshInProgress)
            return;
        pendingAccessReadiness = expected ? 'pending' : 'base-only';
        if (!expected)
        {
            pendingDebugDatabaseAccessChunks = [];
            pendingDebugDatabaseAccessRecordCount = 0;
        }
    }

    function finishDebugDatabaseAccess() : void
    {
        if (refreshInProgress && pendingAccessReadiness == 'pending')
            pendingAccessReadiness = pendingDebugDatabaseAccessRecordCount > 0 ? 'complete' : 'failed';
    }

    function discardDebugDatabaseAccessChunks() : void
    {
        if (refreshInProgress)
        {
            pendingDebugDatabaseAccessChunks = [];
            pendingDebugDatabaseAccessRecordCount = 0;
            pendingAccessReadiness = pendingAccessReadiness == 'pending' || pendingAccessReadiness == 'complete'
                ? 'failed'
                : 'base-only';
        }
    }

    function recordDebugDatabaseSettings(
        settings: Partial<CachedScriptSettings>,
        engineSupportsCreateBlueprint: boolean,
        accessExpected = false,
    ) : void
    {
        if (!refreshInProgress || !pendingScriptSettings)
            return;
        pendingScriptSettings = { ...pendingScriptSettings, ...settings };
        pendingEngineSupportsCreateBlueprint = engineSupportsCreateBlueprint;
        setDebugDatabaseAccessExpected(accessExpected);
    }

    function clearCandidate() : void
    {
        pendingDebugDatabaseChunks = [];
        pendingDebugDatabaseAccessChunks = [];
        pendingDebugDatabaseAccessRecordCount = 0;
        pendingAccessReadiness = 'base-only';
        pendingScriptSettings = null;
        pendingEngineSupportsCreateBlueprint = null;
        refreshInProgress = false;
    }

    function abortRefresh() : boolean
    {
        if (!refreshInProgress)
            return false;
        clearCandidate();
        return true;
    }

    async function restoreAcceptedGeneration(prior: AcceptedDebugDatabaseGeneration | null, recoveryCheck: () => void = () => {}) : Promise<void>
    {
        if (prior)
        {
            applyCachedScriptSettings(prior.scriptSettings, prior.engineSupportsCreateBlueprint);
            await hydrateTypeDatabaseGenerationCooperatively(prior.chunks, prior.scriptSettings.floatIsFloat64, prior.accessChunks, recoveryCheck);
            await resolveAllScriptModulesCooperatively(recoveryCheck);
        }
        else
        {
            await resetTypeDatabaseCooperatively(recoveryCheck);
            await resolveAllScriptModulesCooperatively(recoveryCheck);
        }
        api_search.InvalidateAPISearchCache();
    }

    function prepareAcceptedPublication(
        acceptedId: number,
        revision: string,
        accessState: 'base-only' | 'base+access',
        chunks: unknown[],
        accessChunks: DebugDatabaseAccessChunk[],
        settings: CachedScriptSettings,
        blueprintSupport: boolean,
    ) : DebugDatabaseCachePublication
    {
        let contextSnapshot = cacheContext ? { ...cacheContext, budgets: { ...cacheContext.budgets } } : null;
        let payload: DebugDatabaseCachePayload | null = contextSnapshot ? immutableJsonClone({
            projectIdentity: contextSnapshot.projectIdentity,
            producer: cacheProducer,
            scriptSettings: settings,
            engineSupportsCreateBlueprint: blueprintSupport,
            accessState,
            debugDatabaseChunks: chunks,
            ...(accessState == 'base+access' ? { debugDatabaseAccessChunks: accessChunks } : {}),
        }) : null;
        return {
            generation: acceptedId,
            revision,
            publish: async (isCurrent) => {
                if (!contextSnapshot || !payload)
                    throw new Error('DebugDatabase cache is not configured.');
                let write = options.publishCache ?? saveDebugDatabaseCacheV2Async;
                return write(contextSnapshot, payload, isCurrent);
            },
        };
    }

    async function acceptCompleteCandidate(check: () => void = () => {}, recoveryCheck: () => void = () => {}) : Promise<{ generation: number; revision: string }>
    {
        if (!refreshInProgress)
            throw new Error('DebugDatabase candidate is incomplete or contains no chunks.');
        if (pendingDebugDatabaseChunks.length == 0)
        {
            clearCandidate();
            throw new Error('DebugDatabase candidate is incomplete or contains no chunks.');
        }

        let nextChunks = immutableJsonClone(pendingDebugDatabaseChunks);
        let nextAccessState: 'base-only' | 'base+access' = pendingAccessReadiness == 'complete'
            ? 'base+access'
            : 'base-only';
        let nextAccessChunks = nextAccessState == 'base+access'
            ? immutableJsonClone(pendingDebugDatabaseAccessChunks)
            : [];
        let nextSettings = { ...(pendingScriptSettings ?? getCurrentScriptSettings()) };
        let nextBlueprintSupport = pendingEngineSupportsCreateBlueprint
            ?? scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint;
        let nextRevision = createDebugDatabaseRevision(nextChunks, nextAccessChunks);
        let acceptedId = generation;
        let prior = acceptedGeneration;

        let preparedPublication: DebugDatabaseCachePublication;
        try
        {
            await new Promise<void>((resolve) => setImmediate(resolve));
            check();
            applyCachedScriptSettings(nextSettings, nextBlueprintSupport);
            let diagnosticStartedAt = performance.now();
            let diagnosticSucceeded = false;
            options.onDiagnostic?.('type_database_begin', { phase: 'hydrate', chunkCount: nextChunks.length });
            try
            {
                await hydrateTypeDatabaseGenerationCooperatively(nextChunks, nextSettings.floatIsFloat64, nextAccessChunks, check);
                diagnosticSucceeded = true;
            }
            finally
            {
                options.onDiagnostic?.('type_database_end', { phase: 'hydrate', durationMs: performance.now() - diagnosticStartedAt, chunkCount: nextChunks.length, succeeded: diagnosticSucceeded });
            }
            diagnosticStartedAt = performance.now();
            diagnosticSucceeded = false;
            options.onDiagnostic?.('type_database_begin', { phase: 'resolve_scripts' });
            try
            {
                await resolveAllScriptModulesCooperatively(check);
                diagnosticSucceeded = true;
            }
            finally
            {
                options.onDiagnostic?.('type_database_end', { phase: 'resolve_scripts', durationMs: performance.now() - diagnosticStartedAt, succeeded: diagnosticSucceeded });
            }
            check();
            preparedPublication = prepareAcceptedPublication(acceptedId, nextRevision, nextAccessState, nextChunks, nextAccessChunks, nextSettings, nextBlueprintSupport);
            check();
        }
        catch (error)
        {
            clearCandidate();
            if ((error as { code?: string })?.code === 'LanguageServerTypeDatabaseDeadlineExceeded')
                throw error;
            try
            {
                await restoreAcceptedGeneration(prior, recoveryCheck);
            }
            catch (rollbackError)
            {
                if ((rollbackError as { code?: string })?.code === 'LanguageServerTypeDatabaseDeadlineExceeded')
                    throw rollbackError;
                acceptedGeneration = null;
                throw Object.assign(new Error(`DebugDatabase candidate failed (${String(error)}); accepted generation restore failed (${String(rollbackError)}).`), { code: 'TypeDatabaseRecoveryFailed' });
            }
            throw error;
        }

        acceptedGeneration = {
            generation: acceptedId,
            chunks: nextChunks,
            accessChunks: nextAccessChunks,
            scriptSettings: nextSettings,
            engineSupportsCreateBlueprint: nextBlueprintSupport,
            revision: nextRevision,
            accessState: nextAccessState,
        };
        clearCandidate();
        api_search.InvalidateAPISearchCache();

        pendingPublication = { accepted: acceptedGeneration, task: preparedPublication };
        return { generation: acceptedId, revision: nextRevision };
    }

    function approveAcceptedPublication(acceptedId: number) : void
    {
        if (!pendingPublication || pendingPublication.accepted.generation !== acceptedId || acceptedGeneration !== pendingPublication.accepted)
            return;
        const approved = pendingPublication.task;
        pendingPublication = null;
        publisher.submit(approved);
    }

    function invalidateSearchCache() : void
    {
        api_search.InvalidateAPISearchCache();
    }

    function loadCacheFromDisk() : UnrealCacheLoadOutcome
    {
        if (!cacheContext)
            return { loaded: false, code: 'not-configured', message: 'Cache is not configured.' };
        if (cacheContext.access == 'disabled')
            return { loaded: false, code: 'disabled', message: 'Cache is disabled because exact project identity is unavailable.' };
        if (typedb.HasTypesFromUnreal())
        {
            let activeRevision = acceptedGeneration?.revision;
            return { loaded: true, code: 'already-ready', message: 'Type database is already populated.', revision: activeRevision };
        }

        let result = loadDebugDatabaseCacheV2(cacheContext);
        if (result.ok === false)
        {
            publisher.setInitialState('missing');
            return { loaded: false, code: result.code, message: result.message };
        }

        let previousSettings = getCurrentScriptSettings();
        let previousBlueprintSupport = scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint;
        try
        {
            applyCachedScriptSettings(result.cache.scriptSettings, result.cache.engineSupportsCreateBlueprint);
            let accessChunks = (result.cache.accessState == 'base+access' ? result.cache.debugDatabaseAccessChunks ?? [] : [])
                .map((chunk) => normalizeDebugDatabaseAccessChunk(chunk));
            hydrateTypeDatabaseGeneration(result.cache.debugDatabaseChunks, scriptfiles.GetScriptSettings().floatIsFloat64, accessChunks);
        }
        catch (error)
        {
            applyCachedScriptSettings(previousSettings, previousBlueprintSupport);
            publisher.setInitialState('missing');
            return { loaded: false, code: 'hydrate-failed', message: `Cache TypeDB hydration failed: ${String(error)}` };
        }
        api_search.InvalidateAPISearchCache();
        acceptedGeneration = {
            generation,
            chunks: immutableJsonClone(result.cache.debugDatabaseChunks),
            accessChunks: (result.cache.debugDatabaseAccessChunks ?? [])
                .map((chunk) => normalizeDebugDatabaseAccessChunk(chunk)),
            scriptSettings: getCurrentScriptSettings(),
            engineSupportsCreateBlueprint: scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint,
            revision: result.cache.revision,
            accessState: result.cache.accessState,
        };
        publisher.setInitialState('clean', result.cache.revision);
        return { loaded: true, code: 'loaded', message: 'Loaded debug database cache.', revision: result.cache.revision };
    }

    return {
        configure,
        beginRefresh,
        abortRefresh,
        isRefreshInProgress: () => refreshInProgress,
        hasAcceptedGeneration: () => acceptedGeneration != null,
        recordDebugDatabaseChunk,
        recordDebugDatabaseAccessChunk,
        setDebugDatabaseAccessExpected,
        finishDebugDatabaseAccess,
        discardDebugDatabaseAccessChunks,
        getDebugDatabaseAccessReadiness: () => refreshInProgress
            ? pendingAccessReadiness
            : acceptedGeneration?.accessState == 'base+access' ? 'complete' : 'base-only',
        recordDebugDatabaseSettings,
        acceptCompleteCandidate,
        approveAcceptedPublication,
        invalidateSearchCache,
        loadCacheFromDisk,
        getActiveRevision: () => acceptedGeneration?.revision,
        getActiveGeneration: () => acceptedGeneration?.generation,
        getGeneration: () => generation,
        getPersistenceStatus: publisher.snapshot,
        flushPersistence: publisher.flush,
        shutdownPersistence: publisher.shutdown,
    };
}
