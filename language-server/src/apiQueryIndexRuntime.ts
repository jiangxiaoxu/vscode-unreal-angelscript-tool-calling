import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type {
    ApiQueryMaterializedEntry,
    ApiQueryMaterializedScope,
    ApiQueryKind,
    ApiQueryMatch,
    ApiQuerySource,
    GetAPIExactSymbolsParams,
    GetAPIExactSymbolsResult,
    GetAPIQueryParams,
    GetAPIQueryResult,
} from './api_query_engine';
import type {
    ApiMaterializedMemberOwner,
    ApiSymbolMember,
    GetAPIClassHierarchyParams,
    GetAPIClassHierarchyResult,
    GetAPISymbolMembersParams,
    GetAPISymbolMembersResult,
} from './api_docs';

export const API_QUERY_INDEX_SCHEMA = 'unreal-angelscript-api-query-index';
export const API_QUERY_INDEX_VERSION = 1;

export type ApiQueryIndexInheritanceEdge = {
    type: string;
    superType: string;
};

export type ApiQueryIndexV1 = {
    schema: typeof API_QUERY_INDEX_SCHEMA;
    version: typeof API_QUERY_INDEX_VERSION;
    projectIdentity: string;
    debugDatabaseRevision: string;
    scriptContentRevision: string;
    scriptFiles: Array<{ module: string; path: string; contentHash: string }>;
    producerHash: string;
    createdAt: string;
    recordsHash: string;
    records: ApiQueryMatch[];
    searchEntries: ApiQueryMaterializedEntry[];
    scopes: ApiQueryMaterializedScope[];
    memberOwners: ApiMaterializedMemberOwner[];
    inheritance: ApiQueryIndexInheritanceEdge[];
};

function stableRecordKey(record: ApiQueryMatch) : string
{
    return `${record.qualifiedName}\u0000${record.source}\u0000${record.kind}\u0000${record.symbolId ?? record.signature}`;
}

export function computeApiQueryIndexRecordsHash(
    records: readonly ApiQueryMatch[],
    inheritance: readonly ApiQueryIndexInheritanceEdge[],
    searchEntries: readonly ApiQueryMaterializedEntry[] = [],
    scopes: readonly ApiQueryMaterializedScope[] = [],
    memberOwners: readonly ApiMaterializedMemberOwner[] = [],
) : string
{
    return createHash('sha256').update(JSON.stringify({ records, inheritance, searchEntries, scopes, memberOwners })).digest('hex');
}

export function computeScriptContentRevision(
    files: readonly { module: string; path: string; contentHash: string }[]
) : string
{
    return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

export function validateApiQueryIndex(index: unknown) : ApiQueryIndexV1
{
    if (!index || typeof index != 'object' || Array.isArray(index))
        throw new Error('API query index must be an object.');
    let value = index as ApiQueryIndexV1;
    if (value.schema != API_QUERY_INDEX_SCHEMA || value.version != API_QUERY_INDEX_VERSION)
        throw new Error('Unsupported API query index schema.');
    if (!Array.isArray(value.records) || !Array.isArray(value.inheritance)
        || !Array.isArray(value.searchEntries) || !Array.isArray(value.scopes) || !Array.isArray(value.memberOwners))
        throw new Error('API query index records are missing.');
    if (!Array.isArray(value.scriptFiles)
        || typeof value.scriptContentRevision != 'string'
        || computeScriptContentRevision(value.scriptFiles) != value.scriptContentRevision)
        throw new Error('API query index script content revision mismatch.');
    let expectedHash = computeApiQueryIndexRecordsHash(value.records, value.inheritance, value.searchEntries, value.scopes, value.memberOwners);
    if (expectedHash != value.recordsHash)
        throw new Error('API query index records hash mismatch.');
    return value;
}

export function validateApiQueryIndexCompatibility(
    index: ApiQueryIndexV1,
    expected: {
        projectIdentity: string;
        debugDatabaseRevision: string;
        scriptContentRevision: string;
        producerHash?: string;
    }
) : void
{
    validateApiQueryIndex(index);
    if (index.projectIdentity != expected.projectIdentity)
        throw new Error('API query index project identity mismatch.');
    if (index.debugDatabaseRevision != expected.debugDatabaseRevision)
        throw new Error('API query index DebugDatabase revision mismatch.');
    if (index.scriptContentRevision != expected.scriptContentRevision)
        throw new Error('API query index script content revision mismatch.');
    if (expected.producerHash && index.producerHash != expected.producerHash)
        throw new Error('API query index producer mismatch.');
}

export function encodeApiQueryIndex(index: ApiQueryIndexV1) : Buffer
{
    validateApiQueryIndex(index);
    return gzipSync(Buffer.from(JSON.stringify(index), 'utf8'), { level: 6 });
}

export function decodeApiQueryIndex(data: Uint8Array, maxUncompressedBytes = 256 * 1024 * 1024) : ApiQueryIndexV1
{
    let plain = gunzipSync(data, { maxOutputLength: maxUncompressedBytes });
    return validateApiQueryIndex(JSON.parse(plain.toString('utf8')));
}

function matchesSource(record: ApiQueryMatch, source: ApiQuerySource | undefined) : boolean
{
    return !source || source == 'both' || record.source == source || record.source == 'both';
}

function matchesScope(record: ApiQueryMatch, scope: string | undefined) : boolean
{
    if (!scope)
        return true;
    return record.containerQualifiedName == scope
        || record.ownerQualifiedName == scope
        || record.qualifiedName.startsWith(`${scope}.`)
        || record.qualifiedName.startsWith(`${scope}::`);
}

function smartTokens(query: string) : string[]
{
    return query.toLowerCase().split(/[\s:*?.:;()]+/).filter(Boolean);
}

function scoreSmart(record: ApiQueryMatch, query: string) : number | null
{
    let qualified = record.qualifiedName.toLowerCase();
    let shortName = record.shortName.toLowerCase();
    let normalized = query.trim().toLowerCase().replace(/\(\)$/, '');
    if (qualified == normalized)
        return 0;
    if (shortName == normalized)
        return 1;
    let cursor = 0;
    let gap = 0;
    for (let token of smartTokens(normalized))
    {
        let found = qualified.indexOf(token, cursor);
        if (found < 0)
            return null;
        gap += found - cursor;
        cursor = found + token.length;
    }
    return 10 + gap;
}

function scoreMaterializedEntry(entry: ApiQueryMaterializedEntry, query: string) : number | null
{
    let raw = query.trim();
    let callableOnly = /\(\)\s*;?$/.test(raw);
    raw = raw.replace(/;\s*$/, '').replace(/\(\)\s*$/, '').trim();
    if (callableOnly && !entry.isCallable)
        return null;
    let branches = raw.split('|').map((branch) => branch.trim()).filter(Boolean);
    if (branches.length == 0)
        return null;
    let views = [entry.qualifiedName, ...entry.qualifiedAliases, entry.shortName];
    let best: number | null = null;
    for (let branch of branches)
    {
        let normalized = branch.toLowerCase();
        for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1)
        {
            let view = views[viewIndex].toLowerCase();
            let score: number | null = null;
            if (view == normalized)
                score = viewIndex == 0 ? 0 : viewIndex == views.length - 1 ? 2 : 1;
            else
            {
                let cursor = 0;
                let gap = 0;
                for (let token of smartTokens(normalized))
                {
                    let found = view.indexOf(token, cursor);
                    if (found < 0)
                    {
                        cursor = -1;
                        break;
                    }
                    gap += found - cursor;
                    cursor = found + token.length;
                }
                if (cursor >= 0)
                    score = 10 + gap + viewIndex;
            }
            if (score != null && (best == null || score < best))
                best = score;
        }
    }
    return best;
}

function materializedEntryToMatch(index: ApiQueryIndexV1, entry: ApiQueryMaterializedEntry) : ApiQueryMatch
{
    let direct = index.records.find((record) => record.qualifiedName == entry.qualifiedName
        && record.source == entry.source
        && record.signature == entry.signature);
    if (direct)
        return { ...direct };
    return {
        qualifiedName: entry.qualifiedName,
        shortName: entry.shortName,
        namespaceQualifiedName: entry.namespaceQualifiedName,
        kind: entry.kind,
        signature: entry.signature,
        source: entry.source,
        visibility: entry.visibility,
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.documentation ? { documentation: entry.documentation } : {}),
        ...(entry.containerQualifiedName ? { containerQualifiedName: entry.containerQualifiedName } : {}),
        ...(entry.detailsData !== undefined ? { detailsData: entry.detailsData } : {}),
        ...(entry.isCallable !== undefined ? { isCallable: entry.isCallable } : {}),
        ...(entry.isMixin ? { isMixin: true } : {}),
        ...(entry.ownerQualifiedName ? { ownerQualifiedName: entry.ownerQualifiedName } : {}),
        ...(entry.symbolId ? { symbolId: entry.symbolId } : {}),
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.requiredArgumentCount !== undefined ? { requiredArgumentCount: entry.requiredArgumentCount } : {}),
    };
}

function scopeAncestors(index: ApiQueryIndexV1, qualifiedName: string) : Array<{ qualifiedName: string; distance: number }>
{
    let result: Array<{ qualifiedName: string; distance: number }> = [];
    let seen = new Set<string>([qualifiedName]);
    let cursor = qualifiedName;
    for (let distance = 1; distance <= 100; distance += 1)
    {
        let parent = index.scopes.find((scope) => scope.qualifiedName == cursor)?.directSuperQualifiedName
            ?? index.inheritance.find((edge) => edge.type == cursor)?.superType;
        if (!parent || seen.has(parent))
            break;
        seen.add(parent);
        result.push({ qualifiedName: parent, distance });
        cursor = parent;
    }
    return result;
}

function isEntryInNamespace(entry: ApiQueryMaterializedEntry, namespace: string) : boolean
{
    if (entry.declaringTypeQualifiedName)
        return entry.declaringTypeQualifiedName.startsWith(`${namespace}::`);
    if (entry.kind == 'class' || entry.kind == 'struct' || entry.kind == 'enum')
        return entry.qualifiedName.startsWith(`${namespace}::`);
    return entry.namespaceQualifiedName == namespace || entry.namespaceQualifiedName.startsWith(`${namespace}::`);
}

function buildRegex(query: string) : RegExp
{
    if (!query.startsWith('/'))
        throw new Error("Regex query must use /pattern/flags syntax.");
    let last = query.lastIndexOf('/');
    if (last <= 0)
        throw new Error("Regex query must use /pattern/flags syntax.");
    return new RegExp(query.substring(1, last), query.substring(last + 1));
}

export function queryApiQueryIndex(index: ApiQueryIndexV1, params: GetAPIQueryParams) : GetAPIQueryResult
{
    validateApiQueryIndex(index);
    if (!params || typeof params.query != 'string' || params.query.trim().length == 0)
        throw new Error("Invalid params. 'query' must be a non-empty string.");
    if (params.mode !== undefined && params.mode != 'smart' && params.mode != 'regex')
        throw new Error("Invalid params. 'mode' must be smart or regex.");
    if (params.source !== undefined && params.source != 'native' && params.source != 'script' && params.source != 'both')
        throw new Error("Invalid params. 'source' must be native, script, or both.");
    if (params.declaredOnly !== undefined && typeof params.declaredOnly != 'boolean')
        throw new Error("Invalid params. 'declaredOnly' must be a boolean.");
    if (params.excludeInherited !== undefined && typeof params.excludeInherited != 'boolean')
        throw new Error("Invalid params. 'excludeInherited' must be a boolean.");
    if (params.declaredOnly !== undefined && params.excludeInherited !== undefined)
        throw new Error("Invalid params. 'declaredOnly' and 'excludeInherited' cannot be combined.");
    if ((params.declaredOnly !== undefined || params.excludeInherited !== undefined) && !params.scope)
        throw new Error("Invalid params. 'declaredOnly' and 'excludeInherited' require 'scope'.");
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 1000))
        throw new Error("Invalid params. 'limit' must be between 1 and 1000.");
    if (params.offset !== undefined && (!Number.isInteger(params.offset) || params.offset < 0))
        throw new Error("Invalid params. 'offset' must be a non-negative integer.");
    let kinds = params.kinds ? new Set<ApiQueryKind>(params.kinds) : undefined;
    if (kinds?.has('namespace'))
        throw new Error("Invalid params. 'kinds' does not support namespace.");
    let regex = params.mode == 'regex' ? buildRegex(params.query.trim()) : undefined;
    let entries = index.searchEntries.length > 0
        ? index.searchEntries
        : index.records.map((record) : ApiQueryMaterializedEntry => ({
            qualifiedName: record.qualifiedName,
            shortName: record.shortName,
            namespaceQualifiedName: record.namespaceQualifiedName,
            kind: record.kind,
            isCallable: record.isCallable === true,
            signature: record.signature,
            ...(record.summary ? { summary: record.summary } : {}),
            ...(record.documentation ? { documentation: record.documentation } : {}),
            ...(record.containerQualifiedName ? { containerQualifiedName: record.containerQualifiedName } : {}),
            source: record.source == 'both' ? 'script' : record.source,
            filterSource: record.source,
            visibility: record.visibility,
            isMixin: record.isMixin === true,
            qualifiedAliases: [],
            ...(record.ownerQualifiedName ? { ownerQualifiedName: record.ownerQualifiedName } : {}),
            ...(record.symbolId ? { symbolId: record.symbolId } : {}),
            ...(record.args ? { args: record.args } : {}),
            ...(record.requiredArgumentCount !== undefined ? { requiredArgumentCount: record.requiredArgumentCount } : {}),
        }));

    let scopeCandidates: ApiQueryMaterializedScope[] = [];
    let scopeQualifiedName: string | undefined;
    if (params.scope)
    {
        let requestedScope = params.scope.trim();
        scopeCandidates = index.scopes.filter((scope) => scope.qualifiedName == requestedScope);
        if (scopeCandidates.length == 0)
            scopeCandidates = index.scopes.filter((scope) => scope.shortName == requestedScope);
        let qualifiedNames = [...new Set(scopeCandidates.map((scope) => scope.qualifiedName))];
        if (qualifiedNames.length != 1)
        {
            return {
                ok: true,
                data: {
                    query: params.query.trim(), mode: params.mode ?? 'smart', matches: [], total: 0,
                    returned: 0, limit: params.limit ?? 20, offset: params.offset ?? 0, omitted: 0, truncated: false,
                    notices: [{ code: qualifiedNames.length == 0 ? 'scope_not_found' : 'scope_ambiguous', message: `Scope could not be resolved uniquely: ${requestedScope}` }],
                    scopeLookup: { requestedScope, ...(qualifiedNames.length > 1 ? { ambiguousCandidates: qualifiedNames } : {}) },
                    inheritedScopeOutcome: qualifiedNames.length == 0 ? 'ignored_scope_not_found' : 'ignored_scope_ambiguous',
                }
            };
        }
        scopeQualifiedName = qualifiedNames[0];
        scopeCandidates.sort((left, right) => Number(left.kind == 'namespace') - Number(right.kind == 'namespace'));
    }

    let ranked = entries.flatMap((entry) =>
    {
        if (params.source && params.source != 'both' && entry.filterSource != 'both' && entry.filterSource != params.source)
            return [];
        if (!params.includeNonPublic && entry.visibility != 'public')
            return [];
        let scopeRelationship: 'declared' | 'inherited' | 'mixin' | undefined;
        let scopeDistance: number | undefined;
        let scopeGroupIndex: number | undefined;
        if (scopeQualifiedName)
        {
            let allowed = false;
            for (let candidateIndex = 0; candidateIndex < scopeCandidates.length; candidateIndex += 1)
            {
                let scope = scopeCandidates[candidateIndex];
                let candidateRelationship: typeof scopeRelationship;
                let candidateDistance: number | undefined;
                if (scope.kind == 'namespace')
                {
                    if (isEntryInNamespace(entry, scopeQualifiedName))
                    {
                        allowed = true;
                        candidateRelationship = 'declared';
                        candidateDistance = 0;
                    }
                }
                else if (entry.declaringTypeQualifiedName == scopeQualifiedName || entry.ownerQualifiedName == scopeQualifiedName)
                {
                    allowed = true;
                    candidateRelationship = 'declared';
                    candidateDistance = 0;
                }
                if (scope.kind != 'namespace' && !params.declaredOnly && entry.isMixin && entry.mixinTargetQualifiedName)
                {
                    let ancestors = scopeAncestors(index, scopeQualifiedName);
                    let ancestor = ancestors.find((candidate) => candidate.qualifiedName == entry.mixinTargetQualifiedName);
                    if (entry.mixinTargetQualifiedName == scopeQualifiedName || ancestor)
                    {
                        allowed = true;
                        candidateRelationship = 'mixin';
                        candidateDistance = ancestor?.distance ?? 0;
                    }
                }
                if (scope.kind != 'namespace' && !params.declaredOnly && !params.excludeInherited && scope.isClassType && entry.declaringTypeQualifiedName)
                {
                    let ancestor = scopeAncestors(index, scopeQualifiedName).find((candidate) => candidate.qualifiedName == entry.declaringTypeQualifiedName);
                    if (ancestor)
                    {
                        allowed = true;
                        candidateRelationship = 'inherited';
                        candidateDistance = ancestor.distance;
                    }
                }
                if (candidateRelationship && scopeGroupIndex === undefined)
                {
                    scopeGroupIndex = candidateIndex;
                    scopeRelationship = candidateRelationship;
                    scopeDistance = candidateDistance;
                }
            }
            if (!allowed)
                return [];
        }
        let score: number | null;
        let regexStart = Number.MAX_SAFE_INTEGER;
        let regexSpan = Number.MAX_SAFE_INTEGER;
        let regexViewPriority = Number.MAX_SAFE_INTEGER;
        if (regex)
        {
            let views = [
                { text: entry.qualifiedName, priority: 0 },
                ...entry.qualifiedAliases.map((text) => ({ text, priority: 1 })),
                { text: entry.shortName, priority: 2 },
            ];
            score = null;
            for (let view of views)
            {
                regex.lastIndex = 0;
                let found = regex.exec(view.text);
                if (!found)
                    continue;
                let span = found[0]?.length ?? 0;
                if (found.index < regexStart
                    || (found.index == regexStart && span < regexSpan)
                    || (found.index == regexStart && span == regexSpan && view.priority < regexViewPriority))
                {
                    regexStart = found.index;
                    regexSpan = span;
                    regexViewPriority = view.priority;
                    score = found.index;
                }
            }
        }
        else
        {
            score = scoreMaterializedEntry(entry, params.query);
        }
        if (score == null)
            return [];
        let match = materializedEntryToMatch(index, entry);
        if (!regex)
        {
            let normalizedQuery = params.query.trim().replace(/;\s*$/, '').replace(/\(\)\s*$/, '').trim().toLowerCase();
            if (entry.qualifiedName.toLowerCase() == normalizedQuery || entry.qualifiedAliases.some((alias) => alias.toLowerCase() == normalizedQuery))
                match.matchReason = 'exact-qualified';
            else if (entry.shortName.toLowerCase() == normalizedQuery)
                match.matchReason = 'exact-short';
            else
                match.matchReason = 'boundary-ordered';
        }
        if (params.symbolLevel == 'type' && match.kind != 'class' && match.kind != 'struct' && match.kind != 'enum')
        {
            let projectedMatchReason = match.matchReason;
            let ownerName = entry.mixinTargetQualifiedName ?? entry.declaringTypeQualifiedName ?? entry.ownerQualifiedName;
            let ownerEntry = ownerName ? entries.find((candidate) => candidate.qualifiedName == ownerName
                && (candidate.kind == 'class' || candidate.kind == 'struct' || candidate.kind == 'enum')) : undefined;
            if (!ownerEntry)
                return [];
            let projected = materializedEntryToMatch(index, ownerEntry);
            match = {
                ...projected,
                matchedBy: entry.isMixin ? 'mixin' : 'member',
                matchedByQualifiedName: entry.qualifiedName,
                matchedByKind: match.kind,
                ...(projectedMatchReason ? { matchReason: projectedMatchReason } : {}),
            };
        }
        if (kinds && !kinds.has(match.kind))
            return [];
        if (!kinds && match.kind == 'constructor')
            return [];
        if (scopeRelationship)
            match.scopeRelationship = scopeRelationship;
        if (scopeDistance !== undefined)
            match.scopeDistance = scopeDistance;
        return [{ record: match, score, overrideKey: entry.overrideKey, entryKind: entry.kind, regexStart, regexSpan, regexViewPriority, scopeGroupIndex }];
    });
    const presentationOrder: Record<ApiQueryKind, number> = {
        namespace: 0, class: 1, struct: 2, enum: 3, constructor: 4, method: 5, function: 6, property: 7, globalVariable: 8,
    };
    let compareRanked = (left: typeof ranked[number], right: typeof ranked[number]) => left.score - right.score
        || left.regexSpan - right.regexSpan
        || left.regexViewPriority - right.regexViewPriority
        || presentationOrder[left.entryKind] - presentationOrder[right.entryKind]
        || left.record.qualifiedName.length - right.record.qualifiedName.length
        || left.record.qualifiedName.localeCompare(right.record.qualifiedName);
    ranked.sort(compareRanked);
    let dedupeRanked = (candidates: typeof ranked, dedupeOverrides: boolean) : typeof ranked =>
    {
        let deduped: typeof ranked = [];
        let seen = new Set<string>();
        let seenOverrides = new Set<string>();
        for (let candidate of candidates)
        {
            let key = stableRecordKey(candidate.record);
            if (seen.has(key))
                continue;
            if (dedupeOverrides && candidate.overrideKey && candidate.record.scopeRelationship == 'inherited')
            {
                if (seenOverrides.has(candidate.overrideKey))
                    continue;
                seenOverrides.add(candidate.overrideKey);
            }
            seen.add(key);
            deduped.push(candidate);
        }
        return deduped;
    };
    if (scopeQualifiedName && scopeCandidates.length > 1)
    {
        let groups = scopeCandidates.map((_, groupIndex) =>
            dedupeRanked(ranked.filter((candidate) => candidate.scopeGroupIndex == groupIndex), true));
        let nextByGroup = groups.map(() => 0);
        let ownerSeeded: typeof ranked = [];
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1)
        {
            if (groups[groupIndex].length > 0)
            {
                ownerSeeded.push(groups[groupIndex][0]);
                nextByGroup[groupIndex] = 1;
            }
        }
        while (true)
        {
            let bestGroup = -1;
            let best: typeof ranked[number] | undefined;
            for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1)
            {
                let candidate = groups[groupIndex][nextByGroup[groupIndex]];
                if (candidate && (!best || compareRanked(candidate, best) < 0))
                {
                    best = candidate;
                    bestGroup = groupIndex;
                }
            }
            if (!best || bestGroup < 0)
                break;
            ownerSeeded.push(best);
            nextByGroup[bestGroup] += 1;
        }
        ranked = dedupeRanked(ownerSeeded, false);
    }
    else
    {
        ranked = dedupeRanked(ranked, true);
    }
    let offset = params.offset ?? 0;
    let limit = params.limit ?? 20;
    let page = ranked.slice(offset, offset + limit);
    let allIndexMatches = entries.map((entry) => materializedEntryToMatch(index, entry));
    let matches = page.map(({ record }) =>
    {
        if (params.includeDocs)
            return record;
        let { documentation, ...withoutDocs } = record;
        return withoutDocs as ApiQueryMatch;
    });
    matches = addIndexConstructorPrefixes(matches, allIndexMatches);
    let resolvedScope = scopeQualifiedName ? scopeCandidates[0] : undefined;
    let scopeGroups = scopeQualifiedName && scopeCandidates.length > 1 ? scopeCandidates.map((scope, groupIndex) => {
        let groupMatches = ranked.filter((candidate) => candidate.scopeGroupIndex == groupIndex);
        let groupPage = page.filter((candidate) => candidate.scopeGroupIndex == groupIndex).map(({ record }) => {
            if (params.includeDocs)
                return record;
            let { documentation, ...withoutDocs } = record;
            return withoutDocs as ApiQueryMatch;
        });
        groupPage = addIndexConstructorPrefixes(groupPage, allIndexMatches);
        return {
            scope: {
                requestedScope: params.scope!.trim(),
                resolvedQualifiedName: scope.qualifiedName,
                resolvedKind: scope.kind,
            },
            matches: groupPage,
            totalMatches: groupMatches.length,
            omittedMatches: Math.max(0, groupMatches.length - groupPage.length),
        };
    }) : undefined;
    return {
        ok: true,
        data: {
            query: params.query.trim(),
            mode: params.mode ?? 'smart',
            matches,
            total: ranked.length,
            returned: matches.length,
            limit,
            offset,
            omitted: Math.max(0, ranked.length - matches.length),
            truncated: offset + matches.length < ranked.length,
            ...(resolvedScope ? {
                scopeLookup: {
                    requestedScope: params.scope!.trim(),
                    resolvedQualifiedName: scopeQualifiedName!,
                    resolvedKind: resolvedScope.kind,
                }
            } : {}),
            ...(scopeGroups ? { scopeGroups } : {}),
            ...(scopeCandidates.some((scope) => scope.isClassType) && !params.declaredOnly && !params.excludeInherited
                ? { inheritedScopeOutcome: 'applied' as const }
                : {}),
        }
    };
}

export function readApiQueryIndexSymbol(index: ApiQueryIndexV1, params: GetAPIExactSymbolsParams) : GetAPIExactSymbolsResult
{
    validateApiQueryIndex(index);
    if (!params || typeof params != 'object' || Array.isArray(params) || typeof params.name != 'string' || params.name.trim().length == 0)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'name' must be a non-empty string." } };
    let validKinds = new Set(['class', 'struct', 'enum', 'constructor', 'method', 'function', 'property', 'globalVariable']);
    if (params.kind !== undefined && !validKinds.has(params.kind))
        return { ok: false, error: { code: 'InvalidParams', message: `Unsupported API query kind: ${String(params.kind)}` } };
    if (params.source !== undefined && params.source != 'native' && params.source != 'script' && params.source != 'both')
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'source' must be native, script, or both." } };
    if (params.includeDocs !== undefined && typeof params.includeDocs != 'boolean')
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'includeDocs' must be a boolean." } };
    if (params.includeNonPublic !== undefined && typeof params.includeNonPublic != 'boolean')
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'includeNonPublic' must be a boolean." } };
    let requested = params.name.trim();
    let dot = requested.lastIndexOf('.');
    let constructorOwner = dot > 0 && dot < requested.length - 1
        && finalIndexNameSegment(requested.substring(0, dot)) == requested.substring(dot + 1)
        ? requested.substring(0, dot)
        : null;
    let hasSymbolId = params.symbolId !== undefined;
    if (params.kind == 'constructor' && !constructorOwner)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. kind 'constructor' requires an exact Type.Type constructor family." } };
    if (hasSymbolId && !constructorOwner)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'symbolId' may only be used with an exact Type.Type constructor family." } };
    if (hasSymbolId && params.kind && params.kind != 'constructor')
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'symbolId' cannot be combined with a non-constructor kind." } };
    if (hasSymbolId && typeof params.symbolId != 'string')
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'symbolId' must be a string." } };
    let symbolId = hasSymbolId ? params.symbolId!.trim().toLowerCase() : '';
    if (hasSymbolId && !/^[0-9a-f]{8,64}$/.test(symbolId))
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'symbolId' must be an 8-64 character SHA-256 hex prefix." } };

    let source = hasSymbolId ? 'both' : (params.source ?? 'both');
    let kind = params.kind ?? (constructorOwner ? 'constructor' : undefined);
    let allCandidates = index.searchEntries.length > 0
        ? index.searchEntries.map((entry) => materializedEntryToMatch(index, entry))
        : index.records.map((record) => ({ ...record }));
    let candidates = allCandidates.filter((record) =>
        (!kind || record.kind == kind)
        && matchesSource(record, source)
        && (hasSymbolId || params.includeNonPublic || record.visibility == 'public'));
    let exactQualified: ApiQueryMatch[] = candidates.filter((record) => record.qualifiedName == requested)
        .map((record) => ({ ...record, matchReason: 'exact-qualified' as const }));
    let symbols: ApiQueryMatch[] = exactQualified.length > 0 || requested.includes('::') || requested.includes('.')
        ? exactQualified
        : candidates.filter((record) => finalIndexNameSegment(record.qualifiedName) == requested)
            .map((record) => ({ ...record, matchReason: 'exact-short' as const }));
    symbols = dedupeIndexMatches(symbols);
    if (constructorOwner)
        symbols = dedupeIndexConstructors(symbols);
    symbols.sort(compareIndexExactMatches);
    if (constructorOwner)
        symbols = addIndexConstructorPrefixes(symbols, allCandidates);
    if (hasSymbolId)
    {
        symbols = symbols.filter((record) => record.symbolId?.toLowerCase().startsWith(symbolId));
        if (symbols.length > 1)
            return { ok: false, error: { code: 'InvalidParams', message: `Constructor symbol ID prefix is ambiguous for ${requested}; provide a longer prefix.` } };
    }
    if (!params.includeDocs)
        symbols = symbols.map((record) => {
            let { documentation, ...withoutDocs } = record;
            return withoutDocs as ApiQueryMatch;
        });
    if (symbols.length == 0)
        return { ok: false, error: { code: 'NotFound', message: `API symbol not found: ${requested}` } };
    return { ok: true, data: { requestedName: requested, found: true, symbols } };
}

function finalIndexNameSegment(name: string) : string
{
    let namespaceIndex = name.lastIndexOf('::');
    let memberIndex = name.lastIndexOf('.');
    return namespaceIndex > memberIndex ? name.substring(namespaceIndex + 2)
        : memberIndex >= 0 ? name.substring(memberIndex + 1) : name;
}

function stableIndexValue(value: unknown) : string
{
    if (Array.isArray(value))
        return `[${value.map(stableIndexValue).join(',')}]`;
    if (value && typeof value == 'object')
    {
        let record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableIndexValue(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function dedupeIndexMatches(matches: ApiQueryMatch[]) : ApiQueryMatch[]
{
    let seen = new Set<string>();
    return matches.filter((match) => {
        let identity = stableIndexValue(match);
        if (seen.has(identity))
            return false;
        seen.add(identity);
        return true;
    });
}

function dedupeIndexConstructors(matches: ApiQueryMatch[]) : ApiQueryMatch[]
{
    let byId = new Map<string, ApiQueryMatch>();
    let withoutId: ApiQueryMatch[] = [];
    for (let match of matches)
    {
        if (match.kind != 'constructor' || !match.symbolId)
        {
            withoutId.push(match);
            continue;
        }
        let key = match.symbolId.toLowerCase();
        let current = byId.get(key);
        if (!current || stableIndexValue(match).localeCompare(stableIndexValue(current)) < 0)
            byId.set(key, match);
    }
    return [...byId.values(), ...withoutId];
}

function canonicalIndexConstructorType(typeName: string) : string
{
    return String(typeName ?? '').trim().replace(/\s+/g, ' ')
        .replace(/\s*&\s*(inout|in|out)\b/g, '&$1')
        .replace(/\s*&\s*/g, '&').replace(/\s*@\s*/g, '@');
}

function compareIndexExactMatches(left: ApiQueryMatch, right: ApiQueryMatch) : number
{
    if (left.kind == 'constructor' && right.kind == 'constructor')
        return (left.requiredArgumentCount ?? 0) - (right.requiredArgumentCount ?? 0)
            || (left.args?.length ?? 0) - (right.args?.length ?? 0)
            || (left.args ?? []).map((arg) => canonicalIndexConstructorType(arg.type)).join('\u0000')
                .localeCompare((right.args ?? []).map((arg) => canonicalIndexConstructorType(arg.type)).join('\u0000'))
            || String(left.symbolId ?? '').localeCompare(String(right.symbolId ?? ''));
    return `${left.qualifiedName}\u0000${left.source}\u0000${left.kind}\u0000${left.signature}`
        .localeCompare(`${right.qualifiedName}\u0000${right.source}\u0000${right.kind}\u0000${right.signature}`);
}

function addIndexConstructorPrefixes(matches: ApiQueryMatch[], familyRecords: readonly ApiQueryMatch[]) : ApiQueryMatch[]
{
    let families = new Map<string, string[]>();
    for (let match of familyRecords)
    {
        if (match.kind == 'constructor' && match.ownerQualifiedName && match.symbolId)
        {
            let family = families.get(match.ownerQualifiedName) ?? [];
            let symbolId = match.symbolId.toLowerCase();
            if (!family.includes(symbolId))
                family.push(symbolId);
            families.set(match.ownerQualifiedName, family);
        }
    }
    return matches.map((match) => {
        if (match.kind != 'constructor' || !match.ownerQualifiedName || !match.symbolId)
            return match;
        let family = families.get(match.ownerQualifiedName) ?? [];
        let normalized = match.symbolId.toLowerCase();
        for (let length = 8; length <= normalized.length; length += 1)
        {
            let prefix = normalized.substring(0, length);
            if (family.filter((candidate) => candidate.startsWith(prefix)).length == 1)
                return { ...match, symbolIdPrefix: prefix };
        }
        return match;
    });
}

export function getApiQueryIndexMembers(index: ApiQueryIndexV1, owner: string) : ApiQueryMatch[]
{
    validateApiQueryIndex(index);
    return index.records
        .filter((record) => record.ownerQualifiedName == owner || record.containerQualifiedName == owner)
        .sort((left, right) => stableRecordKey(left).localeCompare(stableRecordKey(right)));
}

function memberKindAllowed(member: ApiSymbolMember, categories: Set<string>) : boolean
{
    if (member.kind == 'constructor')
        return categories.has('constructor');
    if (member.kind == 'method' || member.kind == 'function')
        return member.isCallable === false ? categories.has('data') : categories.has('callable');
    if (member.kind == 'property' || member.kind == 'globalVariable')
        return categories.has('data');
    return categories.has('type');
}

function projectIndexMember(entry: ApiQueryMaterializedEntry, owner: string, inheritedFrom?: string) : ApiSymbolMember
{
    if (entry.kind == 'namespace')
        throw new Error('Namespace entries cannot be projected as members.');
    let kind: ApiSymbolMember['kind'] = entry.kind;
    if (kind == 'method' && !entry.declaringTypeQualifiedName)
        kind = entry.isCallable ? 'function' : 'property';
    return {
        name: entry.shortName,
        qualifiedName: entry.qualifiedName,
        kind,
        declaration: entry.signature,
        ownerQualifiedName: owner,
        source: entry.source,
        visibility: entry.visibility,
        ...(entry.documentation ? { documentation: entry.documentation } : {}),
        ...(inheritedFrom ? { inheritedFrom } : {}),
        ...(entry.isMixin ? { isMixin: true } : {}),
        isCallable: entry.isCallable,
        ...(entry.symbolId ? { symbolId: entry.symbolId } : {}),
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.requiredArgumentCount !== undefined ? { requiredArgumentCount: entry.requiredArgumentCount } : {}),
    };
}

function compareIndexMembers(left: ApiSymbolMember, right: ApiSymbolMember) : number
{
    let order: Record<ApiSymbolMember['kind'], number> = {
        constructor: 0, method: 1, function: 2, property: 3, globalVariable: 4, class: 5, struct: 6, enum: 7,
    };
    return order[left.kind] - order[right.kind]
        || `${left.qualifiedName}\u0000${left.source}\u0000${left.declaration}\u0000${left.symbolId ?? ''}`
            .localeCompare(`${right.qualifiedName}\u0000${right.source}\u0000${right.declaration}\u0000${right.symbolId ?? ''}`);
}

export function queryApiQueryIndexMembers(index: ApiQueryIndexV1, params: GetAPISymbolMembersParams) : GetAPISymbolMembersResult
{
    validateApiQueryIndex(index);
    if (!params || typeof params.name != 'string' || params.name.trim().length == 0)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'name' must be a non-empty string." } };
    if (!Array.isArray(params.members) || params.members.length == 0)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'members' must be a non-empty array." } };
    let requestedCategories = params.members.includes('all' as never)
        ? new Set(['callable', 'data', 'constructor', 'type'])
        : new Set(params.members as string[]);
    let source = params.source ?? 'both';
    let ownerKind = params.ownerKind ?? 'all';
    let limit = params.limit ?? 20;
    let offset = params.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 0 || limit > 200 || !Number.isInteger(offset) || offset < 0)
        return { ok: false, error: { code: 'InvalidParams', message: 'Invalid member paging options.' } };
    let name = params.name.trim();
    let owners = index.records.filter((record) =>
        (record.qualifiedName == name || record.shortName == name)
        && ((ownerKind != 'type' && record.kind == 'namespace')
            || (ownerKind != 'namespace' && (record.kind == 'class' || record.kind == 'struct' || record.kind == 'enum')))
        && (source == 'both' || record.source == source || record.source == 'both'))
        .map((record) => {
            let { documentation, ...withoutDocs } = record;
            return { ...withoutDocs, matchReason: 'exact-qualified' as const };
        })
        .sort((left, right) => stableRecordKey(left).localeCompare(stableRecordKey(right)));
    let qualifiedNames = [...new Set(owners.map((owner) => owner.qualifiedName))];
    if (owners.length == 0)
    {
        let hasIneligibleOwner = index.records.some((record) => record.qualifiedName == name || record.shortName == name);
        return hasIneligibleOwner
            ? { ok: false, error: { code: 'InvalidParams', message: `API member target is not an eligible namespace or type owner: ${name}` } }
            : { ok: false, error: { code: 'NotFound', message: `API symbol not found: ${name}` } };
    }
    if (qualifiedNames.length > 1)
        return { ok: true, data: { requestedName: name, found: true, symbols: owners, groups: [] } };

    let groups: Extract<GetAPISymbolMembersResult, { ok: true }>['data']['groups'] = [];
    for (let owner of owners)
    {
        let materializedOwner = index.memberOwners.find((candidate) =>
            candidate.ownerQualifiedName == owner.qualifiedName
            && candidate.owner == (owner.kind == 'namespace' ? 'namespace' : 'type')
            && (candidate.ownerSource == owner.source || owner.source == 'both' || candidate.ownerSource == 'both'));
        let items: ApiSymbolMember[];
        if (materializedOwner)
        {
            items = (params.includeInherited ? materializedOwner.inheritedMembers : materializedOwner.directMembers)
                .map((member) => ({ ...member }));
        }
        else
        {
            let entries: Array<{ entry: ApiQueryMaterializedEntry; inheritedFrom?: string }> = index.searchEntries
                .filter((entry) => entry.declaringTypeQualifiedName == owner.qualifiedName || entry.ownerQualifiedName == owner.qualifiedName)
                .map((entry) => ({ entry }));
            if (params.includeInherited)
            {
                for (let ancestor of scopeAncestors(index, owner.qualifiedName))
                {
                    entries.push(...index.searchEntries
                        .filter((entry) => entry.declaringTypeQualifiedName == ancestor.qualifiedName && entry.visibility != 'private' && entry.kind != 'constructor')
                        .map((entry) => ({ entry, inheritedFrom: ancestor.qualifiedName })));
                }
            }
            let applicableTypes = new Set([owner.qualifiedName, ...scopeAncestors(index, owner.qualifiedName).map((ancestor) => ancestor.qualifiedName)]);
            entries.push(...index.searchEntries
                .filter((entry) => entry.isMixin && !!entry.mixinTargetQualifiedName && applicableTypes.has(entry.mixinTargetQualifiedName))
                .map((entry) => ({ entry })));
            items = entries.map(({ entry, inheritedFrom }) => projectIndexMember(entry, owner.qualifiedName, inheritedFrom));
        }
        let seen = new Set<string>();
        items = items
            .filter((member) => memberKindAllowed(member, requestedCategories))
            .filter((member) => source == 'both' || member.source == source)
            .filter((member) => params.includeNonPublic || member.visibility == 'public')
            .filter((member) => {
                let key = `${member.kind}|${member.qualifiedName}|${member.source}|${member.declaration}|${member.symbolId ?? ''}`;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            })
            .sort(compareIndexMembers)
            .map((member) => {
                if (params.includeDocs)
                    return member;
                let { documentation, ...withoutDocs } = member;
                return withoutDocs;
            });
        let page = items.slice(offset, offset + limit);
        groups.push({
            owner: owner.kind == 'namespace' ? 'namespace' : 'type',
            ownerQualifiedName: owner.qualifiedName,
            ownerKind: owner.kind as 'namespace' | 'class' | 'struct' | 'enum',
            ownerSource: owner.source,
            members: {
                items: page,
                total: items.length,
                returned: page.length,
                limit,
                offset,
                omitted: Math.max(0, items.length - page.length),
                truncated: offset + page.length < items.length,
            }
        });
    }
    return { ok: true, data: { requestedName: name, found: true, symbols: owners, groups } };
}

export function getApiQueryIndexHierarchy(index: ApiQueryIndexV1, type: string) : { supertypes: string[]; subtypes: string[] }
{
    validateApiQueryIndex(index);
    let supertypes: string[] = [];
    let seen = new Set<string>();
    let cursor = type;
    while (!seen.has(cursor))
    {
        seen.add(cursor);
        let edge = index.inheritance.find((candidate) => candidate.type == cursor);
        if (!edge)
            break;
        supertypes.push(edge.superType);
        cursor = edge.superType;
    }
    let subtypes = index.inheritance.filter((edge) => edge.superType == type).map((edge) => edge.type).sort();
    return { supertypes, subtypes };
}

export function queryApiQueryIndexHierarchy(index: ApiQueryIndexV1, params: GetAPIClassHierarchyParams) : GetAPIClassHierarchyResult
{
    validateApiQueryIndex(index);
    if (!params || typeof params.name != 'string' || params.name.trim().length == 0)
        return { ok: false, error: { code: 'InvalidParams', message: "Invalid params. 'name' must be a non-empty string." } };
    let source = params.source ?? 'both';
    let maxSuperDepth = params.maxSuperDepth ?? 3;
    let maxSubDepth = params.maxSubDepth ?? 2;
    let maxSubBreadth = params.maxSubBreadth ?? 10;
    if (![maxSuperDepth, maxSubDepth, maxSubBreadth].every((value) => Number.isInteger(value) && value >= 0))
        return { ok: false, error: { code: 'InvalidParams', message: 'Hierarchy limits must be non-negative integers.' } };
    let name = params.name.trim();
    let roots = index.records.filter((record) => record.kind == 'class'
        && (record.qualifiedName == name || record.shortName == name)
        && (source == 'both' || record.source == source));
    let qualifiedNames = [...new Set(roots.map((root) => root.qualifiedName))];
    if (roots.length == 0)
        return { ok: false, error: { code: 'NotFound', message: `Class not found: ${name}` } };
    if (qualifiedNames.length != 1)
        return { ok: false, error: { code: 'InvalidParams', message: `Ambiguous class name: ${name}. Use a qualified name.` } };
    let root = roots[0];
    let idFor = (qualifiedName: string) => {
        let record = index.records.find((candidate) => candidate.kind == 'class' && candidate.qualifiedName == qualifiedName);
        return `${record?.source ?? 'native'}:${qualifiedName}`;
    };
    let sourceFor = (qualifiedName: string) => {
        let record = index.records.find((candidate) => candidate.kind == 'class' && candidate.qualifiedName == qualifiedName);
        return record?.source == 'script'
            ? { source: 'as' as const, filePath: '', startLine: 1, endLine: 1 }
            : { source: 'cpp' as const };
    };
    let superClasses: string[] = [];
    let superSeen = new Set([root.qualifiedName]);
    let current = root.qualifiedName;
    for (let depth = 0; depth < maxSuperDepth; depth += 1)
    {
        let parent = index.inheritance.find((edge) => edge.type == current)?.superType;
        if (!parent || superSeen.has(parent))
            break;
        superSeen.add(parent);
        superClasses.push(idFor(parent));
        current = parent;
    }
    let nextSuper = index.inheritance.find((edge) => edge.type == current)?.superType;
    let superTruncated = !!nextSuper && !superSeen.has(nextSuper);
    let childrenByParent = new Map<string, string[]>();
    for (let edge of index.inheritance)
    {
        let children = childrenByParent.get(edge.superType) ?? [];
        children.push(edge.type);
        childrenByParent.set(edge.superType, children);
    }
    for (let children of childrenByParent.values())
        children.sort((left, right) => idFor(left).localeCompare(idFor(right)));
    let derivedByParent: Record<string, string[]> = {};
    let sourceByClass: Record<string, ReturnType<typeof sourceFor>> = { [idFor(root.qualifiedName)]: sourceFor(root.qualifiedName) };
    let omittedByClass: Record<string, number> = {};
    let visited = new Set([root.qualifiedName]);
    let depthTruncated = false;
    let visit = (parent: string, depth: number) => {
        let children = (childrenByParent.get(parent) ?? []).filter((child) => !visited.has(child));
        if (depth <= 0)
        {
            if (children.length > 0)
                depthTruncated = true;
            return;
        }
        let parentId = idFor(parent);
        if (children.length > maxSubBreadth)
            omittedByClass[parentId] = children.length - maxSubBreadth;
        let kept = children.slice(0, maxSubBreadth);
        if (kept.length > 0)
            derivedByParent[parentId] = [];
        for (let child of kept)
        {
            visited.add(child);
            let childId = idFor(child);
            derivedByParent[parentId].push(childId);
            sourceByClass[childId] = sourceFor(child);
            visit(child, depth - 1);
        }
    };
    visit(root.qualifiedName, maxSubDepth);
    for (let id of superClasses)
    {
        let qualifiedName = id.substring(id.indexOf(':') + 1);
        sourceByClass[id] = sourceFor(qualifiedName);
    }
    let breadthOmitted = Object.values(omittedByClass).reduce((sum, value) => sum + value, 0);
    return {
        ok: true,
        data: {
            requestedName: name,
            found: true,
            root: idFor(root.qualifiedName),
            qualifiedName: root.qualifiedName,
            superClasses,
            derivedByParent,
            sourceByClass,
            limits: { maxSuperDepth, maxSubDepth, maxSubBreadth },
            truncated: { superDepth: superTruncated, subDepth: depthTruncated, subBreadth: breadthOmitted > 0 },
            omitted: {
                superDepth: superTruncated ? 1 : 0,
                subDepth: depthTruncated ? 1 : 0,
                subBreadth: breadthOmitted,
                subBreadthByClass: omittedByClass,
            }
        }
    };
}
