import { LanguageClient } from 'vscode-languageclient/node';
import { GetAPIDetailsBatchRequest, GetAPISearchRequest, GetUnrealConnectionStatusRequest } from './apiRequests';

export type AngelscriptSearchParams = {
    labelQuery: string;
    searchIndex: number;
    maxBatchResults?: number;
    includeDocs?: boolean;
    kinds?: string[];
    source?: SearchSource;
    labelQueryUseRegex?: boolean;
    signatureRegex?: string;
};

export type SearchKind = 'class' | 'struct' | 'enum' | 'method' | 'function' | 'property' | 'globalvariable';
export type SearchSource = 'native' | 'script' | 'both';

export type ApiResultItem = {
    signature: string;
    docs?: string;
    type?: string;
};

export type ApiResponsePayload = {
    labelQuery: string;
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

type SignatureMatch = {
    item: ApiSearchResult;
    parsed: ParsedDetails;
};

type SignatureCacheEntry = {
    results: SignatureMatch[];
    expiresAt: number;
};

const CACHE_TTL_MS = 20000;
const MAX_CACHE_ENTRIES = 50;
const searchCache = new Map<string, CachedSearchEntry>();
const signatureCache = new Map<string, SignatureCacheEntry>();

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

function normalizeSource(rawSource: unknown): SearchSource
{
    if (rawSource === undefined || rawSource === null)
    {
        return 'both';
    }
    if (typeof rawSource !== 'string')
    {
        throw new ApiSearchError(
            'INVALID_SOURCE',
            'Invalid source value. Expected "native", "script", or "both".',
            { receivedSource: rawSource }
        );
    }
    const value = rawSource.trim().toLowerCase();
    if (value === 'native' || value === 'script' || value === 'both')
    {
        return value as SearchSource;
    }
    throw new ApiSearchError(
        'INVALID_SOURCE',
        `Invalid source "${rawSource}". Expected "native", "script", or "both".`,
        { receivedSource: rawSource }
    );
}

function getCacheKey(labelQuery: string, kinds: Set<SearchKind>, source: SearchSource): string
{
    const kindsKey = kinds.size > 0 ? Array.from(kinds.values()).sort().join(',') : '';
    return `${labelQuery}|${kindsKey}|source=${source}`;
}

function getSignatureCacheKey(
    labelQuery: string,
    kinds: Set<SearchKind>,
    source: SearchSource,
    labelQueryUseRegex: boolean,
    signatureRegex: string
): string
{
    const kindsKey = kinds.size > 0 ? Array.from(kinds.values()).sort().join(',') : '';
    return `${labelQuery}|${kindsKey}|source=${source}|labelQueryUseRegex=${labelQueryUseRegex ? '1' : '0'}|signatureRegex=${signatureRegex}`;
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

function getCachedSignatureMatches(cacheKey: string, now: number): SignatureMatch[] | null
{
    const entry = signatureCache.get(cacheKey);
    if (!entry)
    {
        return null;
    }
    if (entry.expiresAt <= now)
    {
        signatureCache.delete(cacheKey);
        return null;
    }
    entry.expiresAt = now + CACHE_TTL_MS;
    signatureCache.delete(cacheKey);
    signatureCache.set(cacheKey, entry);
    return entry.results;
}

function setCachedSignatureMatches(cacheKey: string, results: SignatureMatch[], now: number): void
{
    while (signatureCache.size >= MAX_CACHE_ENTRIES)
    {
        const oldestKey = signatureCache.keys().next().value as string | undefined;
        if (!oldestKey)
        {
            break;
        }
        signatureCache.delete(oldestKey);
    }
    signatureCache.set(cacheKey, { results, expiresAt: now + CACHE_TTL_MS });
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

type ParsedRegex = {
    pattern: string;
    flags: string;
    usesLiteralSyntax: boolean;
};

function parseRegexPattern(raw: string, defaultIgnoreCase: boolean): ParsedRegex
{
    if (raw.length >= 2 && raw.startsWith('/') && raw.lastIndexOf('/') > 0)
    {
        const lastSlash = raw.lastIndexOf('/');
        const pattern = raw.slice(1, lastSlash);
        const flags = raw.slice(lastSlash + 1);
        return {
            pattern,
            flags,
            usesLiteralSyntax: true
        };
    }

    return {
        pattern: raw,
        flags: defaultIgnoreCase ? 'i' : '',
        usesLiteralSyntax: false
    };
}

function buildRegex(rawPattern: string, defaultIgnoreCase: boolean): RegExp
{
    try
    {
        const parsed = parseRegexPattern(rawPattern, defaultIgnoreCase);
        if (parsed.usesLiteralSyntax && parsed.flags && !/^[gimsuy]+$/.test(parsed.flags))
        {
            throw new Error(`Invalid regex flags "${parsed.flags}".`);
        }
        return new RegExp(parsed.pattern, parsed.flags);
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        throw new ApiSearchError(
            'INVALID_REGEX',
            `Invalid regex pattern "${rawPattern}". ${message}`,
            { pattern: rawPattern }
        );
    }
}

function regexTest(regex: RegExp, text: string): boolean
{
    if (regex.global || regex.sticky)
    {
        regex.lastIndex = 0;
    }
    return regex.test(text);
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
    const labelQuery = typeof params.labelQuery === 'string' ? params.labelQuery.trim() : '';
    const includeDocs = params.includeDocs === true;
    const searchIndex = Number(params.searchIndex);
    const maxBatchResults = resolveMaxBatchResults(params.maxBatchResults);
    const labelQueryUseRegex = params.labelQueryUseRegex === true;
    const source = normalizeSource(params.source);
    const signatureRegexPattern = typeof params.signatureRegex === 'string'
        ? params.signatureRegex.trim()
        : '';
    const hasSignatureRegex = signatureRegexPattern.length > 0;

    if (!labelQuery)
    {
        throw new ApiSearchError(
            'MISSING_LABEL_QUERY',
            'Missing labelQuery. Please provide labelQuery.'
        );
    }

    const now = Date.now();
    const kindFilter = normalizeKinds(params.kinds);
    const cacheKey = getCacheKey(labelQuery, kindFilter, source);
    let baseResults = getCachedResults(cacheKey, now);
    if (!baseResults)
    {
        const results = await client.sendRequest(GetAPISearchRequest, {
            filter: labelQuery,
            source
        });
        if (!Array.isArray(results) || results.length === 0)
        {
            ensureValidSearchIndex(searchIndex, 0);
            return {
                labelQuery,
                searchIndex,
                nextSearchIndex: null,
                remainingCount: 0,
                total: 0,
                returned: 0,
                truncated: false,
                items: []
            };
        }

        const normalizedResults = sortByRelevance(normalizeSearchResults(results), labelQuery);
        baseResults = kindFilter.size === 0
            ? normalizedResults
            : normalizedResults.filter((result) =>
            {
                const kind = getResultKind(result);
                return kind ? kindFilter.has(kind) : false;
            });
        setCachedResults(cacheKey, baseResults, now);
    }
    let filteredResults = baseResults;
    if (labelQueryUseRegex)
    {
        const regex = buildRegex(labelQuery, true);
        filteredResults = baseResults.filter((result) => regexTest(regex, result.label));
    }
    if (hasSignatureRegex)
    {
        const signatureCacheKey = getSignatureCacheKey(
            labelQuery,
            kindFilter,
            source,
            labelQueryUseRegex,
            signatureRegexPattern
        );
        const cachedSignatureMatches = getCachedSignatureMatches(signatureCacheKey, now);
        if (cachedSignatureMatches)
        {
            ensureValidSearchIndex(searchIndex, cachedSignatureMatches.length);
            const startIndex = searchIndex;
            const endIndex = Math.min(startIndex + maxBatchResults, cachedSignatureMatches.length);
            const pagedMatches = cachedSignatureMatches.slice(startIndex, endIndex);
            const nextSearchIndex = endIndex < cachedSignatureMatches.length ? endIndex : null;
            const remainingCount = nextSearchIndex === null
                ? 0
                : Math.max(0, cachedSignatureMatches.length - endIndex);
            const payloadBase: ApiResponsePayload = {
                labelQuery,
                searchIndex,
                nextSearchIndex,
                remainingCount,
                total: cachedSignatureMatches.length,
                returned: pagedMatches.length,
                truncated: endIndex < cachedSignatureMatches.length,
                items: []
            };

            if (pagedMatches.length === 0)
            {
                return payloadBase;
            }

            payloadBase.items = pagedMatches.map((entry) => ({
                signature: entry.parsed.signature,
                docs: includeDocs ? entry.parsed.docs : undefined,
                type: entry.item.type ?? undefined
            }));
            return payloadBase;
        }

        const regex = buildRegex(signatureRegexPattern, true);
        if (filteredResults.length === 0)
        {
            ensureValidSearchIndex(searchIndex, 0);
            return {
                labelQuery,
                searchIndex,
                nextSearchIndex: null,
                remainingCount: 0,
                total: 0,
                returned: 0,
                truncated: false,
                items: []
            };
        }

        let detailsList: string[] = [];
        try
        {
            const requestPayload = filteredResults.map((item) => item.data);
            const response = await client.sendRequest(GetAPIDetailsBatchRequest, requestPayload);
            if (Array.isArray(response))
            {
                detailsList = response as string[];
            }
        } catch
        {
            throw new ApiSearchError(
                'DETAILS_UNAVAILABLE',
                'Failed to fetch details for signatureRegex filtering.'
            );
        }

        const signatureMatches: Array<{
            item: ApiSearchResult;
            parsed: ParsedDetails;
        }> = [];

        for (let index = 0; index < filteredResults.length; index += 1)
        {
            const resultItem = filteredResults[index];
            const parsed = parseDetails(detailsList[index]);
            const signature = parsed.signature || resultItem.label;
            if (regexTest(regex, signature))
            {
                signatureMatches.push({ item: resultItem, parsed: { signature, docs: parsed.docs } });
            }
        }

        setCachedSignatureMatches(signatureCacheKey, signatureMatches, now);
        ensureValidSearchIndex(searchIndex, signatureMatches.length);
        const startIndex = searchIndex;
        const endIndex = Math.min(startIndex + maxBatchResults, signatureMatches.length);
        const pagedMatches = signatureMatches.slice(startIndex, endIndex);
        const nextSearchIndex = endIndex < signatureMatches.length ? endIndex : null;
        const remainingCount = nextSearchIndex === null
            ? 0
            : Math.max(0, signatureMatches.length - endIndex);
        const payloadBase: ApiResponsePayload = {
            labelQuery,
            searchIndex,
            nextSearchIndex,
            remainingCount,
            total: signatureMatches.length,
            returned: pagedMatches.length,
            truncated: endIndex < signatureMatches.length,
            items: []
        };

        if (pagedMatches.length === 0)
        {
            return payloadBase;
        }

        payloadBase.items = pagedMatches.map((entry) => ({
            signature: entry.parsed.signature,
            docs: includeDocs ? entry.parsed.docs : undefined,
            type: entry.item.type ?? undefined
        }));
        return payloadBase;
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
        labelQuery,
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
            type: item.type ?? undefined
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
            type: item.type ?? undefined
        };
    });

    return payloadBase;
}
