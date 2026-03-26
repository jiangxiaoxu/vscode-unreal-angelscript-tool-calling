import * as scriptfiles from './as_parser';
import * as typedb from './database';
import * as scriptlenses from './code_lenses';
import * as api_search from './api_search';
import * as cache from './cache';

export type UnrealCacheController = {
    resetState: () => void;
    recordDebugDatabaseChunk: (chunk: any) => void;
    markDebugDatabaseComplete: () => void;
    invalidateSearchCache: () => void;
    loadCacheFromDisk: (cacheRootPath: string, unrealConnected: boolean) => void;
    scheduleWrite: (cacheRootPath: string, unrealConnected: boolean) => void;
};

export function createUnrealCacheController() : UnrealCacheController
{
    let debugDatabaseChunks : Array<any> = [];
    let debugDatabaseComplete = false;
    let unrealCacheWriteTimeout : any = null;

    function GetCurrentScriptSettings() : cache.CachedScriptSettings
    {
        let scriptSettings = scriptfiles.GetScriptSettings();
        return {
            automaticImports: scriptSettings.automaticImports,
            floatIsFloat64: scriptSettings.floatIsFloat64,
            useAngelscriptHaze: scriptSettings.useAngelscriptHaze,
            deprecateStaticClass: scriptSettings.deprecateStaticClass,
            disallowStaticClass: scriptSettings.disallowStaticClass,
            exposeGlobalFunctions: scriptSettings.exposeGlobalFunctions,
            deprecateActorGenerics: scriptSettings.deprecateActorGenerics,
            disallowActorGenerics: scriptSettings.disallowActorGenerics,
        };
    }

    function ApplyCachedScriptSettings(settings : cache.CachedScriptSettings, engineSupportsCreateBlueprint : boolean)
    {
        if (!settings)
            return;

        let scriptSettings = scriptfiles.GetScriptSettings();
        if (typeof settings.automaticImports === "boolean")
            scriptSettings.automaticImports = settings.automaticImports;
        if (typeof settings.floatIsFloat64 === "boolean")
            scriptSettings.floatIsFloat64 = settings.floatIsFloat64;
        if (typeof settings.useAngelscriptHaze === "boolean")
            scriptSettings.useAngelscriptHaze = settings.useAngelscriptHaze;
        if (typeof settings.deprecateStaticClass === "boolean")
            scriptSettings.deprecateStaticClass = settings.deprecateStaticClass;
        if (typeof settings.disallowStaticClass === "boolean")
            scriptSettings.disallowStaticClass = settings.disallowStaticClass;
        if (typeof settings.exposeGlobalFunctions === "boolean")
            scriptSettings.exposeGlobalFunctions = settings.exposeGlobalFunctions;
        if (typeof settings.deprecateActorGenerics === "boolean")
            scriptSettings.deprecateActorGenerics = settings.deprecateActorGenerics;
        if (typeof settings.disallowActorGenerics === "boolean")
            scriptSettings.disallowActorGenerics = settings.disallowActorGenerics;

        if (typeof engineSupportsCreateBlueprint === "boolean")
            scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint = engineSupportsCreateBlueprint;
    }

    function resetState()
    {
        debugDatabaseChunks = [];
        debugDatabaseComplete = false;
        api_search.InvalidateAPISearchCache();
    }

    function recordDebugDatabaseChunk(chunk : any)
    {
        debugDatabaseChunks.push(chunk);
    }

    function markDebugDatabaseComplete()
    {
        debugDatabaseComplete = true;
    }

    function invalidateSearchCache()
    {
        api_search.InvalidateAPISearchCache();
    }

    function loadCacheFromDisk(cacheRootPath : string, unrealConnected : boolean)
    {
        if (!cacheRootPath)
            return;

        cache.SetCacheRoot(cacheRootPath);
        if (typedb.HasTypesFromUnreal())
            return;

        let unrealCache = cache.LoadUnrealCache();
        if (unrealCache && unrealCache.debugDatabaseChunks && unrealCache.debugDatabaseChunks.length != 0)
        {
            ApplyCachedScriptSettings(unrealCache.scriptSettings, unrealCache.engineSupportsCreateBlueprint);

            for (let chunk of unrealCache.debugDatabaseChunks)
                typedb.AddTypesFromUnreal(chunk);
            typedb.FinishTypesFromUnreal();

            let scriptSettings = scriptfiles.GetScriptSettings();
            typedb.AddPrimitiveTypes(scriptSettings.floatIsFloat64);
            api_search.InvalidateAPISearchCache();
        }

        if (unrealConnected)
            scheduleWrite(cacheRootPath, unrealConnected);
    }

    function scheduleWrite(cacheRootPath : string, unrealConnected : boolean)
    {
        if (!cacheRootPath || !unrealConnected)
            return;
        if (!debugDatabaseComplete)
            return;
        if (unrealCacheWriteTimeout)
            clearTimeout(unrealCacheWriteTimeout);
        unrealCacheWriteTimeout = setTimeout(function()
        {
            unrealCacheWriteTimeout = null;
            if (!cacheRootPath || !unrealConnected)
                return;
            if (!debugDatabaseComplete)
                return;
            if (debugDatabaseChunks.length == 0)
                return;

            cache.SaveUnrealCache({
                version: 0,
                createdAt: "",
                workspaceRoot: "",
                debugDatabaseChunks: debugDatabaseChunks,
                scriptSettings: GetCurrentScriptSettings(),
                engineSupportsCreateBlueprint: scriptlenses.GetCodeLensSettings().engineSupportsCreateBlueprint,
            });
        }, 500);
    }

    return {
        resetState,
        recordDebugDatabaseChunk,
        markDebugDatabaseComplete,
        invalidateSearchCache,
        loadCacheFromDisk,
        scheduleWrite
    };
}
