import * as scriptfiles from './as_parser';
import * as typedb from './database';
import * as scriptlenses from './code_lenses';
import * as api_search from './api_search';
import {
    DebugDatabaseCacheContext,
    DebugDatabaseCacheProducer,
    DebugDatabaseCacheV2,
    createDebugDatabaseRevision,
    loadDebugDatabaseCacheV2,
    saveDebugDatabaseCacheV2,
} from './debugDatabaseCacheV2';
import { hydrateTypeDatabaseGeneration, resolveAllScriptModulesForGeneration } from './typeDatabaseGeneration';

type CachedScriptSettings = {
    floatIsFloat64 : boolean;
    useAngelscriptHaze : boolean;
    deprecateStaticClass : boolean;
    disallowStaticClass : boolean;
    exposeGlobalFunctions : boolean;
    deprecateActorGenerics : boolean;
    disallowActorGenerics : boolean;
};

export type UnrealCacheLoadOutcome = {
    loaded: boolean;
    code: string;
    message: string;
    revision?: string;
};

export type UnrealCacheController = {
    configure: (context: DebugDatabaseCacheContext, producer: DebugDatabaseCacheProducer) => void;
    beginRefresh: () => number;
    recordDebugDatabaseChunk: (chunk: unknown) => void;
    hydrateRecordedGeneration: () => void;
    markDebugDatabaseComplete: () => void;
    invalidateSearchCache: () => void;
    loadCacheFromDisk: () => UnrealCacheLoadOutcome;
    scheduleWrite: (
        unrealConnected: boolean,
        onPublished?: (cache: DebugDatabaseCacheV2) => void,
        onError?: (error: unknown) => void
    ) => void;
    getRevision: () => string | undefined;
    getGeneration: () => number;
    cancelPendingWrite: () => void;
};

export function createUnrealCacheController() : UnrealCacheController
{
    let pendingDebugDatabaseChunks : Array<unknown> = [];
    let debugDatabaseComplete = false;
    let unrealCacheWriteTimeout : NodeJS.Timeout | null = null;
    let cacheContext : DebugDatabaseCacheContext | null = null;
    let cacheProducer : DebugDatabaseCacheProducer = {
        extensionVersion: 'development',
        languageServerCommit: 'unknown',
    };
    let activeRevision : string | undefined;
    let acceptedGeneration: {
        chunks: unknown[];
        scriptSettings: CachedScriptSettings;
        engineSupportsCreateBlueprint: boolean;
        revision: string;
    } | null = null;
    let generation = 0;

    function configure(context: DebugDatabaseCacheContext, producer: DebugDatabaseCacheProducer) : void
    {
        cacheContext = context;
        cacheProducer = producer;
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
        if (!settings)
            return;
        let scriptSettings = scriptfiles.GetScriptSettings();
        for (let key of Object.keys(settings) as Array<keyof CachedScriptSettings>)
        {
            if (typeof settings[key] == 'boolean' && key in scriptSettings)
                (scriptSettings as unknown as Record<string, boolean>)[key] = settings[key];
        }
        if (typeof engineSupportsCreateBlueprint == 'boolean')
            scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint = engineSupportsCreateBlueprint;
    }

    function beginRefresh() : number
    {
        generation += 1;
        cancelPendingWrite();
        pendingDebugDatabaseChunks = [];
        debugDatabaseComplete = false;
        api_search.InvalidateAPISearchCache();
        return generation;
    }

    function recordDebugDatabaseChunk(chunk: unknown) : void
    {
        pendingDebugDatabaseChunks.push(chunk);
    }

    function markDebugDatabaseComplete() : void
    {
        debugDatabaseComplete = true;
        activeRevision = createDebugDatabaseRevision(pendingDebugDatabaseChunks);
    }

    function invalidateSearchCache() : void
    {
        api_search.InvalidateAPISearchCache();
    }

    function loadCacheFromDisk() : UnrealCacheLoadOutcome
    {
        if (!cacheContext)
            return { loaded: false, code: 'not-configured', message: 'Cache is not configured.' };
        if (typedb.HasTypesFromUnreal())
            return { loaded: true, code: 'already-ready', message: 'Type database is already populated.', revision: activeRevision };

        let result = loadDebugDatabaseCacheV2(cacheContext);
        if (result.ok === false)
            return { loaded: false, code: result.code, message: result.message };

        let previousSettings = getCurrentScriptSettings();
        let previousBlueprintSupport = scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint;
        try
        {
            applyCachedScriptSettings(result.cache.scriptSettings, result.cache.engineSupportsCreateBlueprint);
            hydrateTypeDatabaseGeneration(result.cache.debugDatabaseChunks, scriptfiles.GetScriptSettings().floatIsFloat64);
        }
        catch (error)
        {
            applyCachedScriptSettings(previousSettings, previousBlueprintSupport);
            return { loaded: false, code: 'hydrate-failed', message: `Cache TypeDB hydration failed: ${String(error)}` };
        }
        api_search.InvalidateAPISearchCache();
        activeRevision = result.cache.revision;
        acceptedGeneration = {
            chunks: result.cache.debugDatabaseChunks.slice(),
            scriptSettings: getCurrentScriptSettings(),
            engineSupportsCreateBlueprint: scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint,
            revision: result.cache.revision,
        };
        return { loaded: true, code: 'loaded', message: 'Loaded debug database cache v2.', revision: activeRevision };
    }

    function hydrateRecordedGeneration() : void
    {
        if (pendingDebugDatabaseChunks.length == 0)
            throw new Error('DebugDatabase generation contains no chunks.');
        let nextChunks = pendingDebugDatabaseChunks.slice();
        let nextSettings = getCurrentScriptSettings();
        let nextBlueprintSupport = scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint;
        let prior = acceptedGeneration;
        try
        {
            hydrateTypeDatabaseGeneration(nextChunks, nextSettings.floatIsFloat64);
        }
        catch (error)
        {
            if (prior)
            {
                applyCachedScriptSettings(prior.scriptSettings, prior.engineSupportsCreateBlueprint);
                try
                {
                    hydrateTypeDatabaseGeneration(prior.chunks, prior.scriptSettings.floatIsFloat64);
                    resolveAllScriptModulesForGeneration();
                    activeRevision = prior.revision;
                }
                catch (rollbackError)
                {
                    activeRevision = undefined;
                    acceptedGeneration = null;
                    throw new Error(`DebugDatabase hydration failed (${String(error)}); prior generation restore failed (${String(rollbackError)}).`);
                }
            }
            throw error;
        }
        markDebugDatabaseComplete();
        acceptedGeneration = {
            chunks: nextChunks,
            scriptSettings: nextSettings,
            engineSupportsCreateBlueprint: nextBlueprintSupport,
            revision: activeRevision!,
        };
        api_search.InvalidateAPISearchCache();
    }

    function cancelPendingWrite() : void
    {
        if (unrealCacheWriteTimeout)
        {
            clearTimeout(unrealCacheWriteTimeout);
            unrealCacheWriteTimeout = null;
        }
    }

    function scheduleWrite(
        unrealConnected: boolean,
        onPublished?: (cache: DebugDatabaseCacheV2) => void,
        onError?: (error: unknown) => void
    ) : void
    {
        if (!cacheContext || cacheContext.access != 'read-write' || !unrealConnected || !debugDatabaseComplete)
            return;
        cancelPendingWrite();
        let scheduledGeneration = generation;
        let scheduledChunks = acceptedGeneration?.chunks.slice() ?? [];
        unrealCacheWriteTimeout = setTimeout(function()
        {
            unrealCacheWriteTimeout = null;
            if (!cacheContext || cacheContext.access != 'read-write' || !debugDatabaseComplete
                || scheduledGeneration != generation || scheduledChunks.length == 0)
                return;
            let published: DebugDatabaseCacheV2;
            try
            {
                published = saveDebugDatabaseCacheV2(cacheContext, {
                    projectIdentity: cacheContext.projectIdentity,
                    producer: cacheProducer,
                    scriptSettings: getCurrentScriptSettings(),
                    engineSupportsCreateBlueprint: scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint,
                    debugDatabaseChunks: scheduledChunks,
                });
            }
            catch (error)
            {
                onError?.(error);
                return;
            }
            if (scheduledGeneration != generation)
                return;
            activeRevision = published.revision;
            onPublished?.(published);
        }, 500);
    }

    return {
        configure,
        beginRefresh,
        recordDebugDatabaseChunk,
        hydrateRecordedGeneration,
        markDebugDatabaseComplete,
        invalidateSearchCache,
        loadCacheFromDisk,
        scheduleWrite,
        getRevision: () => activeRevision,
        getGeneration: () => generation,
        cancelPendingWrite,
    };
}
