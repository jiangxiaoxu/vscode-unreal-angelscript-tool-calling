import { LanguageClient } from 'vscode-languageclient/node';
import {
    GetAPISearchLspResult,
    GetAPISearchParams,
    GetAPISearchRequest,
    GetAPISearchToolData,
    GetAPISearchToolMatch,
    SearchKind,
    SearchMode,
    SearchSource
} from './apiRequests';

export type AngelscriptSearchParams = GetAPISearchParams;

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

const kindAliases: Record<string, SearchKind> = {
    class: 'class',
    struct: 'struct',
    enum: 'enum',
    method: 'method',
    function: 'function',
    property: 'property',
    globalvariable: 'globalVariable'
};

function normalizeMode(rawMode: unknown): SearchMode
{
    if (rawMode === undefined || rawMode === null)
        return 'smart';
    if (typeof rawMode !== 'string')
        throw new ApiSearchError('INVALID_MODE', 'Invalid mode value. Expected "smart", "exact", or "regex".', { receivedMode: rawMode });

    const value = rawMode.trim().toLowerCase();
    if (value === 'smart' || value === 'exact' || value === 'regex')
        return value as SearchMode;

    throw new ApiSearchError('INVALID_MODE', `Invalid mode "${rawMode}". Expected "smart", "exact", or "regex".`, { receivedMode: rawMode });
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

function normalizeKinds(rawKinds: unknown): SearchKind[] | undefined
{
    if (rawKinds === undefined || rawKinds === null)
        return undefined;
    if (!Array.isArray(rawKinds))
        throw new ApiSearchError('INVALID_KINDS', 'Invalid kinds value. Expected an array of search kinds.', { receivedKinds: rawKinds });

    const kinds = new Array<SearchKind>();
    for (const rawKind of rawKinds)
    {
        if (typeof rawKind !== 'string')
            throw new ApiSearchError('INVALID_KINDS', 'Invalid kinds value. Each kind must be a string.', { receivedKinds: rawKinds });
        const normalized = rawKind.trim().toLowerCase();
        const kind = kindAliases[normalized];
        if (!kind)
            throw new ApiSearchError('INVALID_KINDS', `Unsupported kind "${rawKind}".`, { receivedKinds: rawKinds });
        kinds.push(kind);
    }

    return kinds.length > 0 ? kinds : undefined;
}

function stripInternalSearchMatch(match: GetAPISearchLspResult['matches'][number]): GetAPISearchToolMatch
{
    const { detailsData: _detailsData, ...publicMatch } = match;
    return publicMatch;
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
    params: AngelscriptSearchParams
): Promise<GetAPISearchToolData>
{
    const query = typeof params?.query === 'string' ? params.query.trim() : '';
    if (!query)
        throw new ApiSearchError('MISSING_QUERY', 'Missing query. Please provide query.');

    const mode = normalizeMode(params?.mode);
    const limit = normalizeLimit(params?.limit);
    const source = normalizeSource(params?.source);
    const kinds = normalizeKinds(params?.kinds);
    const scopePrefix = typeof params?.scopePrefix === 'string' ? params.scopePrefix.trim() : '';
    const includeInheritedFromScope = params?.includeInheritedFromScope === true;
    const includeInternal = params?.includeInternal === true;

    const result = await client.sendRequest(GetAPISearchRequest, {
        query,
        mode,
        limit,
        ...(kinds ? { kinds } : {}),
        source,
        ...(scopePrefix ? { scopePrefix } : {}),
        includeInheritedFromScope,
        includeInternal
    }) as GetAPISearchLspResult;

    if (!result || !Array.isArray(result.matches))
        throw new ApiSearchError('INVALID_RESPONSE', 'The language server returned an invalid search payload.');

    return {
        matches: result.matches.map(stripInternalSearchMatch),
        ...(Array.isArray(result.notices) && result.notices.length > 0 ? { notices: result.notices } : {}),
        ...(result.scopeLookup ? { scopeLookup: result.scopeLookup } : {}),
        ...(result.inheritedScopeOutcome ? { inheritedScopeOutcome: result.inheritedScopeOutcome } : {}),
        request: {
            query,
            mode,
            limit,
            ...(kinds ? { kinds } : {}),
            source,
            ...(scopePrefix ? { scopePrefix } : {}),
            includeInheritedFromScope,
            includeInternal
        }
    };
}
