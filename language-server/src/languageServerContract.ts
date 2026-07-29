import * as path from 'node:path';
import { WorkspaceFolder } from 'vscode-languageserver/node';

export type AngelScriptLanguageServerRole = 'vscode' | 'project-daemon';
export type AngelScriptCacheAccess = 'read-write' | 'disabled';

export type AngelScriptLanguageServerBudgets = {
    maxCompressedBytes: number;
    maxUncompressedBytes: number;
    maxChunkCount: number;
};

export type AngelScriptLanguageServerInitializationOptions = {
    additionalScriptRootFolders?: WorkspaceFolder[];
    role?: AngelScriptLanguageServerRole;
    canonicalProjectRoot?: string;
    uprojectPath?: string;
    projectIdentity?: string;
    unreal?: {
        online?: boolean;
        debuggerPort?: number;
    };
    cache?: {
        enabled?: boolean;
        budgets?: Partial<AngelScriptLanguageServerBudgets>;
    };
};

export type ResolvedAngelScriptLanguageServerOptions = {
    additionalScriptRootFolders: WorkspaceFolder[];
    role: AngelScriptLanguageServerRole;
    canonicalProjectRoot: string;
    uprojectPath?: string;
    projectIdentity: string;
    unrealOnline: boolean;
    debuggerPort: number;
    cachePath: string;
    cacheAccess: AngelScriptCacheAccess;
    budgets: AngelScriptLanguageServerBudgets;
};

export const DEFAULT_LANGUAGE_SERVER_BUDGETS: AngelScriptLanguageServerBudgets = {
    maxCompressedBytes: 64 * 1024 * 1024,
    maxUncompressedBytes: 256 * 1024 * 1024,
    maxChunkCount: 250000,
};

function normalizeAbsolutePath(value: unknown, fallback: string) : string
{
    if (typeof value != 'string' || value.trim().length == 0)
        return path.resolve(fallback);
    return path.resolve(value.trim());
}

function positiveInteger(value: unknown, fallback: number, name: string) : number
{
    if (value === undefined)
        return fallback;
    if (typeof value != 'number' || !Number.isSafeInteger(value) || value <= 0)
        throw new Error(`Invalid initialization option '${name}': expected a positive integer.`);
    return value;
}

function projectIdentityFor(uprojectPath: string) : string
{
    let normalized = path.normalize(uprojectPath);
    return process.platform == 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolveLanguageServerInitializationOptions(
    raw: unknown,
    inferredProjectRoot: string
) : ResolvedAngelScriptLanguageServerOptions
{
    let options = raw && typeof raw == 'object' && !Array.isArray(raw)
        ? raw as AngelScriptLanguageServerInitializationOptions
        : {};
    let rawCache = options.cache as Record<string, unknown> | undefined;
    if (rawCache && ('path' in rawCache || 'access' in rawCache))
        throw new Error("Initialization options 'cache.path' and 'cache.access' were removed; cache ownership is fixed by role.");
    let role = options.role ?? 'vscode';
    if (role != 'vscode' && role != 'project-daemon')
        throw new Error(`Invalid initialization option 'role': ${String(role)}.`);

    let projectRoot = normalizeAbsolutePath(options.canonicalProjectRoot, inferredProjectRoot);
    let cachePath = role == 'vscode'
        ? path.join(projectRoot, 'Script', '.vscode', 'angelscript', 'debug-database.v2.json.gz')
        : path.join(projectRoot, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz');
    let cacheAccess: AngelScriptCacheAccess = options.cache?.enabled === false ? 'disabled' : 'read-write';
    if (role == 'project-daemon' && cacheAccess != 'read-write')
        throw new Error("Role 'project-daemon' requires its fixed Saved v2 cache writer.");

    if (role == 'project-daemon' && options.unreal?.debuggerPort === undefined)
        throw new Error("Role 'project-daemon' requires the project-derived unreal.debuggerPort.");
    let debuggerPort = positiveInteger(options.unreal?.debuggerPort, 27099, 'unreal.debuggerPort');
    if (debuggerPort > 65535)
        throw new Error("Invalid initialization option 'unreal.debuggerPort': expected a TCP port.");

    let budgetOverrides = options.cache?.budgets ?? {};
    let uprojectPath = typeof options.uprojectPath == 'string' && options.uprojectPath.trim().length != 0
        ? path.resolve(options.uprojectPath.trim())
        : undefined;
    let projectIdentity = typeof options.projectIdentity == 'string' && options.projectIdentity.trim().length != 0
        ? options.projectIdentity.trim()
        : path.normalize(uprojectPath ?? projectRoot).toLowerCase();
    if (role == 'project-daemon' && options.unreal?.online === false)
        throw new Error("Role 'project-daemon' requires unreal.online=true.");
    if (cacheAccess == 'read-write' && (!uprojectPath || !options.projectIdentity?.trim()))
        throw new Error(`Role '${role}' requires an exact uprojectPath and projectIdentity when cache publication is enabled.`);
    if (uprojectPath && projectIdentityFor(path.dirname(uprojectPath)) != projectIdentityFor(projectRoot))
        throw new Error('uprojectPath must belong to canonicalProjectRoot.');
    if (uprojectPath && projectIdentity != projectIdentityFor(uprojectPath))
        throw new Error('projectIdentity must equal the canonical physical uprojectPath identity.');

    return {
        additionalScriptRootFolders: Array.isArray(options.additionalScriptRootFolders)
            ? options.additionalScriptRootFolders
            : [],
        role,
        canonicalProjectRoot: projectRoot,
        uprojectPath,
        projectIdentity,
        unrealOnline: role == 'project-daemon' ? true : options.unreal?.online !== false,
        debuggerPort,
        cachePath,
        cacheAccess,
        budgets: {
            maxCompressedBytes: positiveInteger(budgetOverrides.maxCompressedBytes, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxCompressedBytes, 'cache.budgets.maxCompressedBytes'),
            maxUncompressedBytes: positiveInteger(budgetOverrides.maxUncompressedBytes, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxUncompressedBytes, 'cache.budgets.maxUncompressedBytes'),
            maxChunkCount: positiveInteger(budgetOverrides.maxChunkCount, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxChunkCount, 'cache.budgets.maxChunkCount'),
        }
    };
}
