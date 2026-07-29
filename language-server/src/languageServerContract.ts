import * as path from 'node:path';
import { WorkspaceFolder } from 'vscode-languageserver/node';

export type AngelScriptLanguageServerRole = 'ue-resident' | 'cli-direct' | 'vscode';
export type AngelScriptCacheAccess = 'read-write' | 'read-only';

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
        path?: string;
        access?: AngelScriptCacheAccess;
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

export function resolveLanguageServerInitializationOptions(
    raw: unknown,
    inferredProjectRoot: string
) : ResolvedAngelScriptLanguageServerOptions
{
    let options = raw && typeof raw == 'object' && !Array.isArray(raw)
        ? raw as AngelScriptLanguageServerInitializationOptions
        : {};
    let role = options.role ?? 'vscode';
    if (role != 'ue-resident' && role != 'cli-direct' && role != 'vscode')
        throw new Error(`Invalid initialization option 'role': ${String(role)}.`);

    let projectRoot = normalizeAbsolutePath(options.canonicalProjectRoot, inferredProjectRoot);
    let cachePath = normalizeAbsolutePath(
        options.cache?.path,
        path.join(projectRoot, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz')
    );
    let requestedAccess = options.cache?.access ?? (role == 'ue-resident' ? 'read-write' : 'read-only');
    if (requestedAccess != 'read-only' && requestedAccess != 'read-write')
        throw new Error(`Invalid initialization option 'cache.access': ${String(requestedAccess)}.`);
    if (requestedAccess == 'read-write' && role != 'ue-resident')
        throw new Error("Only role 'ue-resident' may use cache access 'read-write'.");

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

    return {
        additionalScriptRootFolders: Array.isArray(options.additionalScriptRootFolders)
            ? options.additionalScriptRootFolders
            : [],
        role,
        canonicalProjectRoot: projectRoot,
        uprojectPath,
        projectIdentity,
        unrealOnline: options.unreal?.online !== false,
        debuggerPort,
        cachePath,
        cacheAccess: requestedAccess,
        budgets: {
            maxCompressedBytes: positiveInteger(budgetOverrides.maxCompressedBytes, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxCompressedBytes, 'cache.budgets.maxCompressedBytes'),
            maxUncompressedBytes: positiveInteger(budgetOverrides.maxUncompressedBytes, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxUncompressedBytes, 'cache.budgets.maxUncompressedBytes'),
            maxChunkCount: positiveInteger(budgetOverrides.maxChunkCount, DEFAULT_LANGUAGE_SERVER_BUDGETS.maxChunkCount, 'cache.budgets.maxChunkCount'),
        }
    };
}
