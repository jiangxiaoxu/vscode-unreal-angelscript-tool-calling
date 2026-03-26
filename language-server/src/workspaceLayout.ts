import * as fs from 'fs';
import * as path from 'path';

export function ResolveScriptRoot(workspaceRoot : string) : string | null
{
    if (!workspaceRoot)
        return null;

    let normalizedWorkspaceRoot = path.normalize(workspaceRoot);
    let rootName = path.basename(normalizedWorkspaceRoot).toLowerCase();
    if (rootName == "script")
        return normalizedWorkspaceRoot;

    let scriptRoot = path.join(normalizedWorkspaceRoot, "Script");
    try
    {
        let stat = fs.statSync(scriptRoot);
        if (stat.isDirectory())
            return scriptRoot;
    }
    catch
    {
    }
    return null;
}

export function ResolveScriptRoots(workspaceRoots : Array<string>) : Array<string>
{
    if (!workspaceRoots || workspaceRoots.length == 0)
        return [];

    let resolvedRoots : Array<string> = [];
    let seenRoots = new Set<string>();

    for (let workspaceRoot of workspaceRoots)
    {
        let scriptRoot = ResolveScriptRoot(workspaceRoot);
        if (!scriptRoot)
            continue;

        let normalizedScriptRoot = path.normalize(scriptRoot);
        let dedupeKey = process.platform == "win32" ? normalizedScriptRoot.toLowerCase() : normalizedScriptRoot;
        if (seenRoots.has(dedupeKey))
            continue;

        seenRoots.add(dedupeKey);
        resolvedRoots.push(normalizedScriptRoot);
    }

    return resolvedRoots;
}

export function ResolveCacheRoot(scriptRoots : Array<string>) : string | null
{
    if (!scriptRoots || scriptRoots.length == 0)
        return null;
    return scriptRoots[0];
}

export function ResolveScriptRootUris(scriptRoots : Array<string>, getFileUri : (pathname : string) => string) : Array<string>
{
    if (!scriptRoots || scriptRoots.length == 0)
        return [];
    return scriptRoots.map((scriptRoot) => decodeURIComponent(getFileUri(scriptRoot)));
}

export function ResolveInitialScriptIgnorePatterns(initializationOptions : any) : Array<string>
{
    let configuredPatterns = initializationOptions?.scriptIgnorePatterns;
    if (Array.isArray(configuredPatterns))
    {
        let sanitizedPatterns = configuredPatterns
            .filter((pattern : any) => typeof pattern == "string")
            .map((pattern : string) => pattern.trim())
            .filter((pattern : string) => pattern.length != 0);
        if (sanitizedPatterns.length != 0)
            return sanitizedPatterns;
    }

    return [];
}

export function NormalizePathForMatch(pathname : string) : string
{
    let normalized = path.normalize(pathname);
    if (process.platform == "win32")
        return normalized.toLowerCase();
    return normalized;
}

export function IsPathWithinScriptRoots(pathname : string, scriptRootPaths : Array<string>) : boolean
{
    if (!pathname || !scriptRootPaths || scriptRootPaths.length == 0)
        return false;

    let normalizedPath = NormalizePathForMatch(pathname);
    for (let scriptRoot of scriptRootPaths)
    {
        let normalizedRoot = NormalizePathForMatch(scriptRoot);
        if (normalizedPath == normalizedRoot)
            return true;
        if (normalizedPath.startsWith(normalizedRoot + path.sep))
            return true;
    }
    return false;
}

export function IsScriptUri(uri : string, scriptRootPaths : Array<string>, getPathName : (uri : string) => string) : boolean
{
    if (!uri || !uri.startsWith("file://"))
        return false;
    let pathname = getPathName(uri);
    return IsPathWithinScriptRoots(pathname, scriptRootPaths);
}
