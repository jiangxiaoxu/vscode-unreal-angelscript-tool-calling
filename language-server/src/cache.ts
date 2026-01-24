import * as fs from 'fs';
import * as path from 'path';

export type CachedScriptSettings = {
    automaticImports : boolean;
    floatIsFloat64 : boolean;
    useAngelscriptHaze : boolean;
    deprecateStaticClass : boolean;
    disallowStaticClass : boolean;
    exposeGlobalFunctions : boolean;
    deprecateActorGenerics : boolean;
    disallowActorGenerics : boolean;
};

export type UnrealCachePayload = {
    version : number;
    createdAt : string;
    workspaceRoot : string;
    debugDatabaseChunks : any[];
    scriptSettings : CachedScriptSettings;
    engineSupportsCreateBlueprint : boolean;
};

const CACHE_VERSION = 1;
const UNREAL_CACHE_FILENAME = "unreal-cache.json";

let CacheRootPath : string | null = null;

export function SetCacheRoot(rootPath : string | null) : void
{
    CacheRootPath = rootPath;
}

function getCacheDir() : string | null
{
    if (!CacheRootPath || CacheRootPath.length == 0)
        return null;
    return path.join(CacheRootPath, ".vscode", "angelscript");
}

function ensureCacheDir() : string | null
{
    let dir = getCacheDir();
    if (!dir)
        return null;
    try
    {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch
    {
        return null;
    }
    return dir;
}

function readJsonFile<T>(filePath : string) : T | null
{
    try
    {
        if (!fs.existsSync(filePath))
            return null;
        let raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw) as T;
    }
    catch
    {
        return null;
    }
}

function tryReadJsonFile<T>(filePath : string) : T | null
{
    if (!filePath)
        return null;
    return readJsonFile<T>(filePath);
}

function writeFileWithFsync(filePath : string, data : string) : void
{
    let fd = fs.openSync(filePath, "w");
    try
    {
        fs.writeFileSync(fd, data, "utf8");
        fs.fsyncSync(fd);
    }
    finally
    {
        fs.closeSync(fd);
    }
}

function writeJsonAtomic(filePath : string, payload : any) : void
{
    let tempPath = filePath + ".tmp";
    let backupPath = filePath + ".bak";
    let data = JSON.stringify(payload, null, 2);

    writeFileWithFsync(tempPath, data);

    if (fs.existsSync(backupPath))
    {
        try
        {
            fs.unlinkSync(backupPath);
        }
        catch
        {
        }
    }

    if (fs.existsSync(filePath))
    {
        try
        {
            fs.renameSync(filePath, backupPath);
        }
        catch
        {
        }
    }

    fs.renameSync(tempPath, filePath);

    if (fs.existsSync(backupPath))
    {
        try
        {
            fs.unlinkSync(backupPath);
        }
        catch
        {
        }
    }
}

export function LoadUnrealCache() : UnrealCachePayload | null
{
    let dir = getCacheDir();
    if (!dir)
        return null;
    let filePath = path.join(dir, UNREAL_CACHE_FILENAME);
    let payload = tryReadJsonFile<UnrealCachePayload>(filePath);
    if (!payload || payload.version != CACHE_VERSION)
        return null;
    return payload;
}

export function SaveUnrealCache(payload : UnrealCachePayload) : void
{
    let dir = ensureCacheDir();
    if (!dir)
        return;
    payload.version = CACHE_VERSION;
    payload.createdAt = new Date().toISOString();
    payload.workspaceRoot = CacheRootPath ?? "";
    let filePath = path.join(dir, UNREAL_CACHE_FILENAME);
    writeJsonAtomic(filePath, payload);
}
