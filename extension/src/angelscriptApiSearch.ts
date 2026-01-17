import { LanguageClient } from 'vscode-languageclient/node';
import { GetAPIDetailsBatchRequest, GetAPISearchRequest, GetUnrealConnectionStatusRequest } from './apiRequests';

export type AngelscriptSearchParams = {
    query: string;
    searchIndex: number;
    maxBatchResults?: number;
    includeDocs?: boolean;
    kinds?: string[];
};

export type SearchKind = 'class' | 'struct' | 'enum' | 'method' | 'function' | 'property' | 'globalvariable';

export type ApiResultItem = {
    signature: string;
    docs?: string;
    type?: string;
    data?: unknown;
};

export type ApiResponsePayload = {
    query: string;
    searchIndex: number;
    nextSearchIndex: number | null;
    remainingCount: number;
    total: number;
    returned: number;
    truncated: boolean;
    items: ApiResultItem[];
};

export type ApiErrorPayload = {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
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

export function toApiErrorPayload(error: unknown): ApiErrorPayload | null
{
    if (error instanceof ApiSearchError)
    {
        return {
            ok: false,
            error: {
                code: error.code,
                message: error.message,
                details: error.details
            }
        };
    }
    return null;
}

type ApiSearchResult = {
    label: string;
    type?: string;
    data?: unknown;
    index: number;
};

type CachedSearchEntry = {
    results: ApiSearchResult[];
    expiresAt: number;
};

const CACHE_TTL_MS = 20000;
const MAX_CACHE_ENTRIES = 50;
const searchCache = new Map<string, CachedSearchEntry>();

const kindAliases: Record<string, SearchKind> = {
    class: 'class',
    struct: 'struct',
    enum: 'enum',
    method: 'method',
    function: 'function',
    property: 'property',
    globalvariable: 'globalvariable'
};

function normalizeKinds(rawKinds: unknown): Set<SearchKind>
{
    const kinds = new Set<SearchKind>();
    const addKind = (value: string) =>
    {
        const normalized = value.trim().toLowerCase();
        const mapped = kindAliases[normalized];
        if (mapped)
        {
            kinds.add(mapped);
        }
    };

    if (Array.isArray(rawKinds))
    {
        for (const value of rawKinds)
        {
            if (typeof value === 'string')
            {
                addKind(value);
            }
        }
    }
    else if (typeof rawKinds === 'string')
    {
        addKind(rawKinds);
    }

    return kinds;
}

function getCacheKey(query: string, kinds: Set<SearchKind>): string
{
    const normalizedQuery = query.toLowerCase();
    const kindsKey = kinds.size > 0 ? Array.from(kinds.values()).sort().join(',') : '';
    return `${normalizedQuery}|${kindsKey}`;
}

function getCachedResults(cacheKey: string, now: number): ApiSearchResult[] | null
{
    const entry = searchCache.get(cacheKey);
    if (!entry)
    {
        return null;
    }
    if (entry.expiresAt <= now)
    {
        searchCache.delete(cacheKey);
        return null;
    }
    entry.expiresAt = now + CACHE_TTL_MS;
    searchCache.delete(cacheKey);
    searchCache.set(cacheKey, entry);
    return entry.results;
}

function setCachedResults(cacheKey: string, results: ApiSearchResult[], now: number): void
{
    while (searchCache.size >= MAX_CACHE_ENTRIES)
    {
        const oldestKey = searchCache.keys().next().value as string | undefined;
        if (!oldestKey)
        {
            break;
        }
        searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { results, expiresAt: now + CACHE_TTL_MS });
}

function ensureValidSearchIndex(searchIndex: number, total: number): void
{
    const maxIndex = total === 0 ? 0 : total - 1;
    const isValid = Number.isInteger(searchIndex) && searchIndex >= 0 && searchIndex <= maxIndex;
    if (isValid)
    {
        return;
    }

    const received = Number.isFinite(searchIndex) ? searchIndex : String(searchIndex);
    throw new ApiSearchError(
        'INVALID_SEARCH_INDEX',
        `Invalid searchIndex (${received}). Valid range is 0 to ${maxIndex}. Use searchIndex=0 for the first query.`,
        {
            receivedSearchIndex: received,
            validRange: { min: 0, max: maxIndex },
            total
        }
    );
}

function resolveMaxBatchResults(rawValue: number | undefined): number
{
    if (rawValue === undefined)
    {
        return 200;
    }
    if (!Number.isInteger(rawValue) || rawValue < 1)
    {
        const received = Number.isFinite(rawValue) ? rawValue : String(rawValue);
        throw new ApiSearchError(
            'INVALID_MAX_BATCH_RESULTS',
            `Invalid maxBatchResults (${received}). Provide a positive integer.`,
            {
                receivedMaxBatchResults: received
            }
        );
    }
    return rawValue;
}

function getResultKind(result: ApiSearchResult): SearchKind | null
{
    const data = result.data;
    if (Array.isArray(data) && data.length > 0)
    {
        const dataKind = data[0];
        if (typeof dataKind === 'string')
        {
            if (dataKind === 'method')
                return 'method';
            if (dataKind === 'function')
                return 'function';
            if (dataKind === 'property')
                return 'property';
            if (dataKind === 'global')
                return 'globalvariable';
            if (dataKind === 'type')
            {
                const typeKindValue = data[3];
                if (typeof typeKindValue === 'string')
                {
                    const mapped = kindAliases[typeKindValue.toLowerCase()];
                    if (mapped === 'class' || mapped === 'struct' || mapped === 'enum')
                        return mapped;
                }
            }
        }
    }

    if (result.type === 'type' && Array.isArray(data))
    {
        const typeKindValue = data[3];
        if (typeof typeKindValue === 'string')
        {
            const mapped = kindAliases[typeKindValue.toLowerCase()];
            if (mapped === 'class' || mapped === 'struct' || mapped === 'enum')
                return mapped;
        }
    }

    return null;
}

type ParsedDetails = {
    signature: string;
    docs?: string;
};

function parseDetails(details: string | undefined): ParsedDetails
{
    if (typeof details !== 'string')
    {
        return { signature: '' };
    }

    const trimmed = details.trim();
    if (!trimmed)
    {
        return { signature: '' };
    }

    const fence = '```';
    const snippetHeader = `${fence}angelscript_snippet`;
    const headerIndex = details.indexOf(snippetHeader);
    if (headerIndex === -1)
    {
        return { signature: trimmed };
    }

    const snippetStart = details.indexOf('\n', headerIndex + snippetHeader.length);
    if (snippetStart === -1)
    {
        return { signature: trimmed };
    }

    const snippetEnd = details.indexOf(`\n${fence}`, snippetStart + 1);
    if (snippetEnd === -1)
    {
        return { signature: details.substring(snippetStart + 1).trimEnd() };
    }

    const signature = details.substring(snippetStart + 1, snippetEnd).trimEnd();
    const docs = details.substring(snippetEnd + fence.length + 1).trim();
    return {
        signature,
        docs: docs.length > 0 ? docs : undefined
    };
}

function escapeRegExp(value: string): string
{
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getQueryTokens(query: string): string[]
{
    const tokens = query.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);
    return tokens.length > 0 ? tokens : [];
}

function tokensInOrder(text: string, tokens: string[]): boolean
{
    let currentIndex = 0;
    for (const token of tokens)
    {
        const nextIndex = text.indexOf(token, currentIndex);
        if (nextIndex === -1)
        {
            return false;
        }
        currentIndex = nextIndex + token.length;
    }
    return true;
}

function computeRelevanceScore(label: string, query: string): number
{
    const normalizedLabel = label.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    if (!normalizedQuery)
    {
        return 0;
    }

    if (normalizedLabel === normalizedQuery)
    {
        return 1000;
    }

    let score = 0;
    if (normalizedLabel.startsWith(normalizedQuery))
    {
        score = Math.max(score, 900);
    }

    const isWordQuery = /^[a-z0-9_]+$/.test(normalizedQuery);
    if (isWordQuery)
    {
        const wordStartRegex = new RegExp(`\\b${escapeRegExp(normalizedQuery)}`);
        if (wordStartRegex.test(normalizedLabel))
        {
            score = Math.max(score, 850);
        }
    }

    if (normalizedLabel.includes(normalizedQuery))
    {
        score = Math.max(score, 700);
    }

    const tokens = getQueryTokens(normalizedQuery);
    if (tokens.length > 1)
    {
        if (tokensInOrder(normalizedLabel, tokens))
        {
            score = Math.max(score, 650);
        }
        else if (tokens.every((token) => normalizedLabel.includes(token)))
        {
            score = Math.max(score, 600);
        }
    }

    return score;
}

function normalizeSearchResults(results: unknown[]): ApiSearchResult[]
{
    return results.map((item, index) =>
    {
        if (item && typeof item === 'object')
        {
            const record = item as Record<string, unknown>;
            const labelValue = record.label;
            const label = typeof labelValue === 'string' ? labelValue : String(labelValue ?? '');
            const typeValue = record.type;
            const type = typeof typeValue === 'string' ? typeValue : undefined;
            const data = record.data;
            return { label, type, data, index };
        }
        return { label: '', index };
    });
}

function sortByRelevance(results: ApiSearchResult[], query: string): ApiSearchResult[]
{
    return results.slice().sort((left, right) =>
    {
        const leftScore = computeRelevanceScore(left.label, query);
        const rightScore = computeRelevanceScore(right.label, query);
        if (leftScore !== rightScore)
        {
            return rightScore - leftScore;
        }
        if (left.label.length !== right.label.length)
        {
            return left.label.length - right.label.length;
        }
        return left.index - right.index;
    });
}

export async function isUnrealConnected(client: LanguageClient): Promise<boolean>
{
    try
    {
        const result = await client.sendRequest(GetUnrealConnectionStatusRequest);
        return result === true;
    } catch
    {
        return false;
    }
}

export async function buildSearchPayload(
    client: LanguageClient,
    params: AngelscriptSearchParams,
    isCancelled: () => boolean
): Promise<ApiResponsePayload>
{
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const includeDocs = params.includeDocs === true;
    const searchIndex = Number(params.searchIndex);
    const maxBatchResults = resolveMaxBatchResults(params.maxBatchResults);

    if (!query)
    {
        ensureValidSearchIndex(searchIndex, 0);
        return {
            query,
            searchIndex,
            nextSearchIndex: null,
            remainingCount: 0,
            total: 0,
            returned: 0,
            truncated: false,
            items: []
        };
    }

    const now = Date.now();
    const kindFilter = normalizeKinds(params.kinds);
    const cacheKey = getCacheKey(query, kindFilter);
    let filteredResults = getCachedResults(cacheKey, now);
    if (!filteredResults)
    {
        const results = await client.sendRequest(GetAPISearchRequest, query);
        if (!Array.isArray(results) || results.length === 0)
        {
            ensureValidSearchIndex(searchIndex, 0);
            return {
                query,
                searchIndex,
                nextSearchIndex: null,
                remainingCount: 0,
                total: 0,
                returned: 0,
                truncated: false,
                items: []
            };
        }

        const normalizedResults = sortByRelevance(normalizeSearchResults(results), query);
        filteredResults = kindFilter.size === 0
            ? normalizedResults
            : normalizedResults.filter((result) =>
            {
                const kind = getResultKind(result);
                return kind ? kindFilter.has(kind) : false;
            });
        setCachedResults(cacheKey, filteredResults, now);
    }
    ensureValidSearchIndex(searchIndex, filteredResults.length);
    const startIndex = searchIndex;
    const endIndex = Math.min(startIndex + maxBatchResults, filteredResults.length);
    const items = filteredResults.slice(startIndex, endIndex);
    const nextSearchIndex = endIndex < filteredResults.length ? endIndex : null;
    const remainingCount = nextSearchIndex === null
        ? 0
        : Math.max(0, filteredResults.length - endIndex);
    const payloadBase: ApiResponsePayload = {
        query,
        searchIndex,
        nextSearchIndex,
        remainingCount,
        total: filteredResults.length,
        returned: items.length,
        truncated: endIndex < filteredResults.length,
        items: []
    };

    if (items.length === 0)
    {
        return payloadBase;
    }

    if (isCancelled())
    {
        payloadBase.items = items.map((item) => ({
            signature: item.label,
            type: item.type ?? undefined,
            data: item.data ?? undefined
        }));
        return payloadBase;
    }

    let detailsList: string[] = [];
    try
    {
        const requestPayload = items.map((item) => item.data);
        const response = await client.sendRequest(GetAPIDetailsBatchRequest, requestPayload);
        if (Array.isArray(response))
        {
            detailsList = response as string[];
        }
    } catch
    {
        detailsList = [];
    }

    payloadBase.items = items.map((item, index) =>
    {
        const parsed = parseDetails(detailsList[index]);
        const signature = parsed.signature || item.label;
        return {
            signature,
            docs: includeDocs ? parsed.docs : undefined,
            type: item.type ?? undefined,
            data: item.data ?? undefined
        };
    });

    return payloadBase;
}
