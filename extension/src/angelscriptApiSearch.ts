import { LanguageClient } from 'vscode-languageclient/node';
import {
    GetAPISearchLspResult,
    GetAPISearchParams,
    GetAPISearchRequest,
    GetAPISearchToolScopeGroup,
    GetAPISearchToolData,
    GetAPISearchToolMatch,
    SearchKind,
    SearchIncludeInheritedFromScopeMode,
    SearchMode,
    SearchSource,
    SearchSymbolLevel
} from './apiRequests';

export type AngelscriptSearchToolParams = {
    query: string;
    mode?: SearchMode;
    limit?: number;
    kinds?: SearchKind[];
    source?: SearchSource;
    scope?: string;
    includeInheritedFromScope?: boolean;
    includeDocs?: boolean;
    symbolLevel?: SearchSymbolLevel;
};

export class ApiSearchError extends Error
{
    code: string;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>)
    {
        super(message);
        this.name = 'ApiSearchError';
        this.code = code;
        this.details = details;
    }
}

export function toApiSearchToolFailure(error: unknown): { code: string; message: string; details?: Record<string, unknown> } | null
{
    if (!(error instanceof ApiSearchError))
        return null;
    return {
        code: error.code,
        message: error.message,
        details: error.details
    };
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

function hasExplicitIncludeInheritedFromScope(
    params: AngelscriptSearchToolParams
): params is AngelscriptSearchToolParams & { includeInheritedFromScope: boolean }
{
    return Object.prototype.hasOwnProperty.call(params, 'includeInheritedFromScope')
        && typeof params.includeInheritedFromScope === 'boolean';
}

function normalizeSource(rawSource: unknown): SearchSource
{
    if (rawSource === undefined || rawSource === null)
        return 'both';
    if (typeof rawSource !== 'string')
        throw new ApiSearchError('INVALID_SOURCE', 'Invalid source value. Expected "native", "script", or "both".', { receivedSource: rawSource });

    const value = rawSource.trim().toLowerCase();
    if (value === 'native' || value === 'script' || value === 'both')
        return value as SearchSource;

    throw new ApiSearchError('INVALID_SOURCE', `Invalid source "${rawSource}". Expected "native", "script", or "both".`, { receivedSource: rawSource });
}

function normalizeLimit(rawLimit: unknown): number
{
    if (rawLimit === undefined || rawLimit === null)
        return DEFAULT_LIMIT;
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit))
        throw new ApiSearchError('INVALID_LIMIT', 'Invalid limit value. Provide an integer between 1 and 200.', { receivedLimit: rawLimit });
    if (rawLimit < 1 || rawLimit > MAX_LIMIT)
        throw new ApiSearchError('INVALID_LIMIT', `Invalid limit (${rawLimit}). Provide an integer between 1 and 200.`, { receivedLimit: rawLimit });
    return rawLimit;
}

function normalizeMode(rawMode: unknown): SearchMode
{
    if (rawMode === undefined || rawMode === null)
        return 'smart';
    if (typeof rawMode !== 'string')
        throw new ApiSearchError('INVALID_MODE', 'Invalid mode value. Expected "smart" or "regex".', { receivedMode: rawMode });

    const value = rawMode.trim().toLowerCase();
    if (value === 'smart' || value === 'regex')
        return value as SearchMode;

    throw new ApiSearchError('INVALID_MODE', `Invalid mode "${rawMode}". Expected "smart" or "regex".`, { receivedMode: rawMode });
}

function normalizeSymbolLevel(rawSymbolLevel: unknown): SearchSymbolLevel
{
    if (rawSymbolLevel === undefined || rawSymbolLevel === null)
        return 'all';
    if (typeof rawSymbolLevel !== 'string')
        throw new ApiSearchError('INVALID_SYMBOL_LEVEL', 'Invalid symbolLevel value. Expected "all" or "type".', { receivedSymbolLevel: rawSymbolLevel });

    const value = rawSymbolLevel.trim().toLowerCase();
    if (value === 'all' || value === 'type')
        return value as SearchSymbolLevel;

    throw new ApiSearchError('INVALID_SYMBOL_LEVEL', `Invalid symbolLevel "${rawSymbolLevel}". Expected "all" or "type".`, { receivedSymbolLevel: rawSymbolLevel });
}

function stripInternalSearchMatch(match: GetAPISearchLspResult['matches'][number]): GetAPISearchToolMatch
{
    const { detailsData: _detailsData, ...publicMatch } = match;
    return publicMatch;
}

function stripInternalSearchScopeGroup(group: NonNullable<GetAPISearchLspResult['scopeGroups']>[number]): GetAPISearchToolScopeGroup
{
    return {
        scope: group.scope,
        matches: group.matches.map(stripInternalSearchMatch),
        totalMatches: group.totalMatches,
        omittedMatches: group.omittedMatches
    };
}

export async function isUnrealConnected(client: LanguageClient): Promise<boolean>
{
    try
    {
        const result = await client.sendRequest('angelscript/getUnrealConnectionStatus');
        return result === true;
    }
    catch
    {
        return false;
    }
}

export async function buildSearchPayload(
    client: LanguageClient,
    params: AngelscriptSearchToolParams
): Promise<GetAPISearchToolData>
{
    const query = typeof params?.query === 'string' ? params.query.trim() : '';
    if (!query)
        throw new ApiSearchError('MISSING_QUERY', 'Missing query. Please provide query.');

    const mode = normalizeMode(params?.mode);
    const limit = normalizeLimit(params?.limit);
    const source = normalizeSource(params?.source);
    const kinds = Array.isArray(params?.kinds) ? params.kinds : undefined;
    const scope = typeof params?.scope === 'string' ? params.scope.trim() : '';
    const hasExplicitInheritanceMode = hasExplicitIncludeInheritedFromScope(params);
    const includeDocs = params?.includeDocs === true;
    const symbolLevel = normalizeSymbolLevel(params?.symbolLevel);
    const includeInheritedFromScopeMode: SearchIncludeInheritedFromScopeMode = hasExplicitInheritanceMode ? 'explicit' : 'auto';
    const request: GetAPISearchParams = {
        query,
        mode,
        limit,
        ...(kinds && kinds.length > 0 ? { kinds } : {}),
        source,
        ...(scope ? { scope } : {}),
        ...(hasExplicitInheritanceMode ? { includeInheritedFromScope: params.includeInheritedFromScope } : {}),
        includeDocs,
        symbolLevel
    };
    const result = await client.sendRequest(GetAPISearchRequest, request) as GetAPISearchLspResult;

    if (!result || !Array.isArray(result.matches))
        throw new ApiSearchError('INVALID_RESPONSE', 'The language server returned an invalid search payload.');

    const resolvedIncludeInheritedFromScope = resultUsesInheritedScope(result);

    return {
        matches: result.matches.map(stripInternalSearchMatch),
        matchCounts: result.matchCounts,
        ...(Array.isArray(result.notices) && result.notices.length > 0 ? { notices: result.notices } : {}),
        ...(result.scopeLookup ? { scopeLookup: result.scopeLookup } : {}),
        ...(Array.isArray(result.scopeGroups) && result.scopeGroups.length > 0
            ? { scopeGroups: result.scopeGroups.map(stripInternalSearchScopeGroup) }
            : {}),
        ...(result.inheritedScopeOutcome ? { inheritedScopeOutcome: result.inheritedScopeOutcome } : {}),
        request: {
            query,
            mode,
            limit,
            source,
            ...(kinds && kinds.length > 0 ? { kinds } : {}),
            ...(scope ? { scope } : {}),
            includeInheritedFromScopeMode,
            includeInheritedFromScope: resolvedIncludeInheritedFromScope,
            includeDocs,
            symbolLevel
        }
    };
}

function resultUsesInheritedScope(result: GetAPISearchLspResult): boolean
{
    return result.inheritedScopeOutcome === 'applied';
}
