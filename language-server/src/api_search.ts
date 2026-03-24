import * as typedb from './database';

export type ApiSearchMode = 'smart' | 'exact' | 'regex';
export type ApiSearchSource = 'native' | 'script' | 'both';
export type ApiSearchMatchSource = 'native' | 'script';
export type ApiSearchKind = 'class' | 'struct' | 'enum' | 'method' | 'function' | 'property' | 'globalVariable';
export type ApiSearchScopeKind = 'namespace' | 'class' | 'struct' | 'enum';
export type ApiSearchScopeRelationship = 'declared' | 'inherited' | 'mixin';

export type GetAPISearchParams = {
    query: string;
    mode?: ApiSearchMode;
    limit?: number;
    kinds?: ApiSearchKind[];
    source?: ApiSearchSource;
    scopePrefix?: string;
    includeInheritedFromScope?: boolean;
};

export type GetAPISearchNotice = {
    code: string;
    message: string;
};

export type ApiInheritedScopeOutcome =
    | 'applied'
    | 'ignored_missing_scope_prefix'
    | 'ignored_scope_not_found'
    | 'ignored_scope_not_class'
    | 'ignored_scope_ambiguous';

export type GetAPISearchScopeLookup = {
    requestedPrefix: string;
    resolvedQualifiedName?: string;
    resolvedKind?: ApiSearchScopeKind;
    ambiguousCandidates?: string[];
};

export type GetAPISearchMatch = {
    qualifiedName: string;
    kind: ApiSearchKind;
    signature: string;
    summary?: string;
    containerQualifiedName?: string;
    source: ApiSearchMatchSource;
    isMixin?: boolean;
    scopeRelationship?: ApiSearchScopeRelationship;
    scopeDistance?: number;
    detailsData?: unknown;
};

export type GetAPISearchResult = {
    matches: GetAPISearchMatch[];
    notices?: GetAPISearchNotice[];
    scopeLookup?: GetAPISearchScopeLookup;
    inheritedScopeOutcome?: ApiInheritedScopeOutcome;
};

export class ApiSearchValidationError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'ApiSearchValidationError';
    }
}

type NormalizedSearchParams = {
    query: string;
    mode: ApiSearchMode;
    limit: number;
    kinds: Set<ApiSearchKind>;
    source: ApiSearchSource;
    scopePrefix?: string;
    includeInheritedFromScope: boolean;
};

type ScopeCandidate = {
    kind: ApiSearchScopeKind;
    qualifiedName: string;
    shortName: string;
    namespace?: typedb.DBNamespace;
    dbType?: typedb.DBType;
    isClassType: boolean;
};

type SearchTextVariant = {
    text: string;
    textLower: string;
    tokens: string[];
    compact: string;
    initials: string;
};

type SearchIndexEntry = {
    qualifiedName: string;
    kind: ApiSearchKind;
    signature: string;
    summary?: string;
    containerQualifiedName?: string;
    source: ApiSearchMatchSource;
    filterSource: ApiSearchSource;
    detailsData?: unknown;
    shortName: string;
    shortNameLower: string;
    qualifiedNameLower: string;
    shortTokens: string[];
    qualifiedTokens: string[];
    shortCompact: string;
    qualifiedCompact: string;
    shortInitials: string;
    qualifiedInitials: string;
    namespaceQualifiedName: string;
    declaringTypeQualifiedName?: string;
    isMixin: boolean;
    mixinTargetQualifiedName?: string;
    qualifiedAliasTexts: SearchTextVariant[];
    overrideKey?: string;
};

type SearchIndex = {
    entries: SearchIndexEntry[];
    scopeCandidates: ScopeCandidate[];
};

type SearchCandidate = {
    entry: SearchIndexEntry;
    scopeRelationship?: ApiSearchScopeRelationship;
    scopeDistance?: number;
};

type ResolvedScope = {
    kind: 'namespace';
    qualifiedName: string;
    namespace: typedb.DBNamespace;
    scopeLookup: GetAPISearchScopeLookup;
} | {
    kind: 'type';
    qualifiedName: string;
    dbType: typedb.DBType;
    scopeLookup: GetAPISearchScopeLookup;
    includeInherited: boolean;
};

type ScopeResolution = {
    scope: ResolvedScope | null;
    notices: GetAPISearchNotice[];
    scopeLookup: GetAPISearchScopeLookup;
    inheritedScopeOutcome?: ApiInheritedScopeOutcome;
};

type NormalizedQuery = {
    raw: string;
    rawLower: string;
    tokens: string[];
    compact: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;
const QUERY_TOO_SHORT_THRESHOLD = 2;

const allKinds = new Set<ApiSearchKind>([
    'class',
    'struct',
    'enum',
    'method',
    'function',
    'property',
    'globalVariable'
]);

const kindOrder: Record<ApiSearchKind, number> = {
    class: 0,
    struct: 1,
    enum: 2,
    method: 3,
    function: 4,
    property: 5,
    globalVariable: 6
};

const kindAliases: Record<string, ApiSearchKind> = {
    class: 'class',
    struct: 'struct',
    enum: 'enum',
    method: 'method',
    function: 'function',
    property: 'property',
    globalvariable: 'globalVariable'
};

let cachedSearchIndex: SearchIndex | null = null;
let cachedDirtyTypeCacheId = -1;

export function InvalidateAPISearchCache()
{
    cachedSearchIndex = null;
    cachedDirtyTypeCacheId = -1;
}

export function GetAPISearch(payload: unknown) : GetAPISearchResult
{
    let params = normalizeSearchParams(payload);
    let notices: GetAPISearchNotice[] = [];
    let scopeLookup: GetAPISearchScopeLookup | undefined = undefined;
    let inheritedScopeOutcome: ApiInheritedScopeOutcome | undefined = undefined;

    let index = getSearchIndex();
    let candidates = index.entries.map((entry) : SearchCandidate => ({ entry }));

    if (params.includeInheritedFromScope && !params.scopePrefix)
        inheritedScopeOutcome = 'ignored_missing_scope_prefix';

    if (params.scopePrefix)
    {
        let scopeResolution = resolveScope(index, params.scopePrefix, params.includeInheritedFromScope);
        notices.push(...scopeResolution.notices);
        scopeLookup = scopeResolution.scopeLookup;
        inheritedScopeOutcome = scopeResolution.inheritedScopeOutcome;
        if (!scopeResolution.scope)
            return finalizeSearchResult([], notices, scopeLookup, inheritedScopeOutcome);

        if (scopeResolution.scope.kind == 'namespace')
            candidates = applyNamespaceScope(candidates, scopeResolution.scope.qualifiedName);
        else
            candidates = applyTypeScope(candidates, scopeResolution.scope, notices);
    }

    candidates = candidates.filter((candidate) => filterCandidate(candidate.entry, params));

    if (params.mode == 'smart' && isTinySmartQuery(params.query))
    {
        notices.push({
            code: 'QUERY_TOO_SHORT',
            message: `Smart search requires at least ${QUERY_TOO_SHORT_THRESHOLD} searchable characters.`
        });
        return finalizeSearchResult([], notices, scopeLookup, inheritedScopeOutcome);
    }

    let scoredMatches = rankCandidates(candidates, params);
    let limitedMatches = scoredMatches.slice(0, params.limit).map((candidate) => buildMatch(candidate));
    return finalizeSearchResult(limitedMatches, notices, scopeLookup, inheritedScopeOutcome);
}

function normalizeSearchParams(payload: unknown) : NormalizedSearchParams
{
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new ApiSearchValidationError("Invalid params. Provide { query: string, mode?: 'smart' | 'exact' | 'regex', limit?: number, kinds?: ApiSearchKind[], source?: 'native' | 'script' | 'both', scopePrefix?: string, includeInheritedFromScope?: boolean }.");

    let record = payload as Record<string, unknown>;
    let query = typeof record.query === 'string' ? record.query.trim() : '';
    if (query.length == 0)
        throw new ApiSearchValidationError("Invalid params. 'query' must be a non-empty string.");

    let mode = normalizeSearchMode(record.mode);
    let limit = normalizeLimit(record.limit);
    let kinds = normalizeKinds(record.kinds);
    let source = normalizeSource(record.source);
    let scopePrefix = typeof record.scopePrefix === 'string' ? record.scopePrefix.trim() : '';
    let includeInheritedFromScope = record.includeInheritedFromScope === true;

    return {
        query,
        mode,
        limit,
        kinds,
        source,
        ...(scopePrefix.length > 0 ? { scopePrefix } : {}),
        includeInheritedFromScope
    };
}

function normalizeSearchMode(value: unknown) : ApiSearchMode
{
    if (value === undefined)
        return 'smart';
    if (typeof value !== 'string')
        throw new ApiSearchValidationError("Invalid params. 'mode' must be 'smart', 'exact', or 'regex'.");

    let normalized = value.trim().toLowerCase();
    if (normalized == 'smart' || normalized == 'exact' || normalized == 'regex')
        return normalized as ApiSearchMode;

    throw new ApiSearchValidationError("Invalid params. 'mode' must be 'smart', 'exact', or 'regex'.");
}

function normalizeLimit(value: unknown) : number
{
    if (value === undefined)
        return DEFAULT_LIMIT;
    if (typeof value !== 'number' || !Number.isInteger(value))
        throw new ApiSearchValidationError("Invalid params. 'limit' must be an integer.");
    if (value < 1 || value > MAX_LIMIT)
        throw new ApiSearchValidationError(`Invalid params. 'limit' must be between 1 and ${MAX_LIMIT}.`);
    return value;
}

function normalizeKinds(value: unknown) : Set<ApiSearchKind>
{
    if (value === undefined)
        return new Set(allKinds);
    if (!Array.isArray(value))
        throw new ApiSearchValidationError("Invalid params. 'kinds' must be an array.");

    let kinds = new Set<ApiSearchKind>();
    for (let item of value)
    {
        if (typeof item !== 'string')
            throw new ApiSearchValidationError("Invalid params. 'kinds' entries must be strings.");

        let normalized = item.trim().toLowerCase();
        let kind = kindAliases[normalized];
        if (!kind)
            throw new ApiSearchValidationError(`Invalid params. Unsupported kind "${item}".`);
        kinds.add(kind);
    }

    return kinds.size == 0 ? new Set(allKinds) : kinds;
}

function normalizeSource(value: unknown) : ApiSearchSource
{
    if (value === undefined)
        return 'both';
    if (typeof value !== 'string')
        throw new ApiSearchValidationError("Invalid params. 'source' must be 'native', 'script', or 'both'.");

    let normalized = value.trim().toLowerCase();
    if (normalized == 'native' || normalized == 'script' || normalized == 'both')
        return normalized as ApiSearchSource;

    throw new ApiSearchValidationError("Invalid params. 'source' must be 'native', 'script', or 'both'.");
}

function finalizeSearchResult(
    matches: GetAPISearchMatch[],
    notices: GetAPISearchNotice[],
    scopeLookup?: GetAPISearchScopeLookup,
    inheritedScopeOutcome?: ApiInheritedScopeOutcome
) : GetAPISearchResult
{
    let result: GetAPISearchResult = {
        matches
    };

    if (notices.length != 0)
        result.notices = notices;
    if (scopeLookup)
        result.scopeLookup = scopeLookup;
    if (inheritedScopeOutcome)
        result.inheritedScopeOutcome = inheritedScopeOutcome;

    return result;
}

function getSearchIndex() : SearchIndex
{
    let dirtyTypeCacheId = typedb.GetDirtyTypeCacheId();
    if (cachedSearchIndex && cachedDirtyTypeCacheId == dirtyTypeCacheId)
        return cachedSearchIndex;

    cachedSearchIndex = buildSearchIndex();
    cachedDirtyTypeCacheId = dirtyTypeCacheId;
    return cachedSearchIndex;
}

function buildSearchIndex() : SearchIndex
{
    let entries: SearchIndexEntry[] = [];
    let scopeCandidates: ScopeCandidate[] = [];

    let visitNamespace = function (namespace: typedb.DBNamespace)
    {
        if (!namespace.isRootNamespace() && !isNamespaceApiEmpty(namespace))
        {
            let qualifiedNamespace = namespace.getQualifiedNamespace();
            scopeCandidates.push({
                kind: 'namespace',
                qualifiedName: qualifiedNamespace,
                shortName: namespace.name,
                namespace,
                isClassType: false
            });
        }

        for (let [_, childNamespace] of namespace.childNamespaces)
            visitNamespace(childNamespace);

        namespace.forEachSymbol((symbol) =>
        {
            if (symbol instanceof typedb.DBMethod)
            {
                if (shouldSkipMethod(symbol))
                    return;
                entries.push(createMethodEntry(symbol));
                return;
            }

            if (symbol instanceof typedb.DBProperty)
            {
                entries.push(createGlobalPropertyEntry(symbol));
                return;
            }

            if (symbol instanceof typedb.DBType)
                visitType(symbol);
        });
    };

    let visitType = function (dbType: typedb.DBType)
    {
        if (shouldIncludeTypeInSearch(dbType))
        {
            let qualifiedTypeName = dbType.getQualifiedTypenameInNamespace(null);
            let kind = getTypeKind(dbType);
            entries.push(createSearchEntry({
                qualifiedName: qualifiedTypeName,
                kind,
                signature: buildTypeSignature(dbType),
                summary: extractSummary(dbType.documentation),
                containerQualifiedName: dbType.namespace && !dbType.namespace.isRootNamespace()
                    ? dbType.namespace.getQualifiedNamespace()
                    : undefined,
                source: getDeclaredSource(dbType.declaredModule),
                filterSource: getDeclaredSource(dbType.declaredModule),
                detailsData: ['type', dbType.name, dbType.namespace && !dbType.namespace.isRootNamespace()
                    ? dbType.namespace.getQualifiedNamespace()
                    : '', kind],
                namespaceQualifiedName: dbType.namespace && !dbType.namespace.isRootNamespace()
                    ? dbType.namespace.getQualifiedNamespace()
                    : ''
            }));
            scopeCandidates.push({
                kind,
                qualifiedName: qualifiedTypeName,
                shortName: dbType.name,
                dbType,
                isClassType: isClassType(dbType)
            });
        }

        dbType.forEachSymbol((symbol) =>
        {
            if (symbol instanceof typedb.DBMethod)
            {
                if (shouldSkipMethod(symbol))
                    return;
                entries.push(createMethodEntry(symbol));
                return;
            }

            if (symbol instanceof typedb.DBProperty)
                entries.push(createTypePropertyEntry(symbol));
        }, false);
    };

    visitNamespace(typedb.GetRootNamespace());
    return {
        entries,
        scopeCandidates
    };
}

function createMethodEntry(method: typedb.DBMethod) : SearchIndexEntry
{
    let methodArgs = method.args ? method.args.map((arg) => arg.typename) : [];
    let detailsData: unknown;
    let qualifiedName = '';
    let containerQualifiedName: string | undefined = undefined;
    let namespaceQualifiedName = '';
    let declaringTypeQualifiedName: string | undefined = undefined;
    let mixinTargetQualifiedName: string | undefined = undefined;
    let aliasQualifiedNames: string[] | undefined = undefined;

    if (method.containingType)
    {
        declaringTypeQualifiedName = method.containingType.getQualifiedTypenameInNamespace(null);
        qualifiedName = `${declaringTypeQualifiedName}.${method.name}`;
        containerQualifiedName = declaringTypeQualifiedName;
        namespaceQualifiedName = method.containingType.namespace && !method.containingType.namespace.isRootNamespace()
            ? method.containingType.namespace.getQualifiedNamespace()
            : '';
        detailsData = [
            'method',
            method.containingType.name,
            method.name,
            method.id,
            namespaceQualifiedName,
            methodArgs
        ];
    }
    else
    {
        namespaceQualifiedName = method.namespace && !method.namespace.isRootNamespace()
            ? method.namespace.getQualifiedNamespace()
            : '';
        if (method.isMixin)
        {
            mixinTargetQualifiedName = getMixinTargetQualifiedName(method);
            if (mixinTargetQualifiedName)
                aliasQualifiedNames = [`${mixinTargetQualifiedName}.${method.name}`];
        }
        qualifiedName = namespaceQualifiedName.length > 0
            ? `${namespaceQualifiedName}::${method.name}`
            : method.name;
        containerQualifiedName = namespaceQualifiedName.length > 0 ? namespaceQualifiedName : undefined;
        detailsData = [
            'function',
            qualifiedName,
            method.id,
            methodArgs
        ];
    }

    return createSearchEntry({
        qualifiedName,
        kind: method.containingType ? 'method' : 'function',
        signature: buildMethodSignature(method),
        summary: extractSummary(method.findAvailableDocumentation()),
        containerQualifiedName,
        source: getDeclaredSource(method.declaredModule),
        filterSource: getDeclaredSource(method.declaredModule),
        detailsData,
        namespaceQualifiedName,
        declaringTypeQualifiedName,
        isMixin: method.isMixin,
        mixinTargetQualifiedName,
        aliasQualifiedNames,
        overrideKey: buildMethodOverrideKey(method)
    });
}

function createTypePropertyEntry(property: typedb.DBProperty) : SearchIndexEntry
{
    let qualifiedContainer = property.containingType.getQualifiedTypenameInNamespace(null);
    let namespaceQualifiedName = property.containingType.namespace && !property.containingType.namespace.isRootNamespace()
        ? property.containingType.namespace.getQualifiedNamespace()
        : '';

    return createSearchEntry({
        qualifiedName: `${qualifiedContainer}.${property.name}`,
        kind: 'property',
        signature: property.format(`${qualifiedContainer}.`),
        summary: extractSummary(property.documentation),
        containerQualifiedName: qualifiedContainer,
        source: getDeclaredSource(property.declaredModule),
        filterSource: getDeclaredSource(property.declaredModule),
        detailsData: ['property', property.containingType.name, property.name],
        namespaceQualifiedName,
        declaringTypeQualifiedName: qualifiedContainer,
        overrideKey: buildPropertyOverrideKey(property)
    });
}

function createGlobalPropertyEntry(property: typedb.DBProperty) : SearchIndexEntry
{
    let namespaceQualifiedName = property.namespace && !property.namespace.isRootNamespace()
        ? property.namespace.getQualifiedNamespace()
        : '';
    let qualifiedName = namespaceQualifiedName.length > 0
        ? `${namespaceQualifiedName}::${property.name}`
        : property.name;

    return createSearchEntry({
        qualifiedName,
        kind: 'globalVariable',
        signature: property.format(namespaceQualifiedName.length > 0 ? `${namespaceQualifiedName}::` : ''),
        summary: extractSummary(property.documentation),
        containerQualifiedName: namespaceQualifiedName.length > 0 ? namespaceQualifiedName : undefined,
        source: getDeclaredSource(property.declaredModule),
        filterSource: getDeclaredSource(property.declaredModule),
        detailsData: ['global', qualifiedName],
        namespaceQualifiedName
    });
}

function createSearchEntry(input: {
    qualifiedName: string;
    kind: ApiSearchKind;
    signature: string;
    summary?: string;
    containerQualifiedName?: string;
    source: ApiSearchMatchSource;
    filterSource: ApiSearchSource;
    detailsData?: unknown;
    namespaceQualifiedName: string;
    declaringTypeQualifiedName?: string;
    isMixin?: boolean;
    mixinTargetQualifiedName?: string;
    aliasQualifiedNames?: string[];
    overrideKey?: string;
}) : SearchIndexEntry
{
    let shortName = getShortName(input.qualifiedName, input.kind);
    let shortText = createSearchTextVariant(shortName);
    let qualifiedText = createSearchTextVariant(input.qualifiedName);
    let qualifiedAliasTexts = dedupeSearchTextVariants(input.aliasQualifiedNames, qualifiedText.textLower);
    return {
        qualifiedName: input.qualifiedName,
        kind: input.kind,
        signature: input.signature,
        summary: input.summary,
        containerQualifiedName: input.containerQualifiedName,
        source: input.source,
        filterSource: input.filterSource,
        detailsData: input.detailsData,
        shortName,
        shortNameLower: shortText.textLower,
        qualifiedNameLower: qualifiedText.textLower,
        shortTokens: shortText.tokens,
        qualifiedTokens: qualifiedText.tokens,
        shortCompact: shortText.compact,
        qualifiedCompact: qualifiedText.compact,
        shortInitials: shortText.initials,
        qualifiedInitials: qualifiedText.initials,
        namespaceQualifiedName: input.namespaceQualifiedName,
        declaringTypeQualifiedName: input.declaringTypeQualifiedName,
        isMixin: input.isMixin === true,
        mixinTargetQualifiedName: input.mixinTargetQualifiedName,
        qualifiedAliasTexts,
        overrideKey: input.overrideKey
    };
}

function resolveScope(
    index: SearchIndex,
    scopePrefix: string,
    includeInheritedFromScope: boolean
) : ScopeResolution
{
    let notices: GetAPISearchNotice[] = [];
    let normalizedScope = scopePrefix.trim();
    let normalizedScopeLower = normalizedScope.toLowerCase();

    let exactQualifiedCandidates = index.scopeCandidates.filter((candidate) => candidate.qualifiedName.toLowerCase() == normalizedScopeLower);
    let candidates = exactQualifiedCandidates;
    if (candidates.length == 0)
    {
        let exactShortCandidates = index.scopeCandidates.filter((candidate) => candidate.shortName.toLowerCase() == normalizedScopeLower);
        candidates = exactShortCandidates;
    }
    if (candidates.length == 0)
    {
        let prefixCandidates = index.scopeCandidates.filter((candidate) => candidate.qualifiedName.toLowerCase().startsWith(normalizedScopeLower));
        candidates = prefixCandidates;
    }

    let scopeLookup: GetAPISearchScopeLookup = {
        requestedPrefix: normalizedScope
    };

    if (candidates.length == 0)
    {
        return {
            scope: null,
            notices,
            scopeLookup,
            inheritedScopeOutcome: includeInheritedFromScope ? 'ignored_scope_not_found' : undefined
        };
    }

    if (candidates.length > 1)
    {
        scopeLookup.ambiguousCandidates = candidates
            .map((candidate) => candidate.qualifiedName)
            .sort((left, right) => left.localeCompare(right));
        return {
            scope: null,
            notices,
            scopeLookup,
            inheritedScopeOutcome: includeInheritedFromScope ? 'ignored_scope_ambiguous' : undefined
        };
    }

    let candidate = candidates[0];
    scopeLookup.resolvedQualifiedName = candidate.qualifiedName;
    scopeLookup.resolvedKind = candidate.kind;

    if (candidate.kind == 'namespace')
    {
        return {
            scope: {
                kind: 'namespace',
                qualifiedName: candidate.qualifiedName,
                namespace: candidate.namespace,
                scopeLookup
            },
            notices,
            scopeLookup,
            inheritedScopeOutcome: includeInheritedFromScope ? 'ignored_scope_not_class' : undefined
        };
    }

    let appliedIncludeInherited = includeInheritedFromScope && candidate.isClassType;

    return {
        scope: {
            kind: 'type',
            qualifiedName: candidate.qualifiedName,
            dbType: candidate.dbType,
            scopeLookup,
            includeInherited: appliedIncludeInherited
        },
        notices,
        scopeLookup,
        inheritedScopeOutcome: includeInheritedFromScope
            ? (candidate.isClassType ? 'applied' : 'ignored_scope_not_class')
            : undefined
    };
}

function applyNamespaceScope(candidates: SearchCandidate[], namespaceQualifiedName: string) : SearchCandidate[]
{
    return candidates
        .filter((candidate) => isEntryWithinNamespaceScope(candidate.entry, namespaceQualifiedName))
        .map((candidate) => ({
            entry: candidate.entry,
            scopeRelationship: 'declared',
            scopeDistance: 0
        }));
}

function applyTypeScope(
    candidates: SearchCandidate[],
    scope: Extract<ResolvedScope, { kind: 'type' }>,
    notices: GetAPISearchNotice[]
) : SearchCandidate[]
{
    let scopedCandidates: SearchCandidate[] = [];
    let seenOverrideKeys = new Set<string>();
    let inheritanceChain = getScopeInheritanceChain(scope.dbType);
    let typeDistanceByQualifiedName = new Map<string, number>();
    typeDistanceByQualifiedName.set(scope.qualifiedName, 0);
    for (let inheritanceEntry of inheritanceChain)
    {
        if (!typeDistanceByQualifiedName.has(inheritanceEntry.qualifiedName))
            typeDistanceByQualifiedName.set(inheritanceEntry.qualifiedName, inheritanceEntry.distance);
    }

    for (let candidate of candidates)
    {
        let entry = candidate.entry;
        if (entry.qualifiedName == scope.qualifiedName)
        {
            scopedCandidates.push({
                entry,
                scopeRelationship: 'declared',
                scopeDistance: 0
            });
            continue;
        }

        if (entry.declaringTypeQualifiedName == scope.qualifiedName)
        {
            if (entry.overrideKey)
                seenOverrideKeys.add(entry.overrideKey);
            scopedCandidates.push({
                entry,
                scopeRelationship: 'declared',
                scopeDistance: 0
            });
        }
    }

    for (let candidate of candidates)
    {
        let mixinDistance = getMixinScopeDistance(candidate.entry, typeDistanceByQualifiedName);
        if (mixinDistance == null)
            continue;

        scopedCandidates.push({
            entry: candidate.entry,
            scopeRelationship: 'mixin',
            scopeDistance: mixinDistance
        });
    }

    if (!scope.includeInherited)
        return scopedCandidates;

    if (inheritanceChain.length == 0)
    {
        notices.push({
            code: 'SCOPE_INHERITANCE_EMPTY',
            message: `Scope "${scope.qualifiedName}" has no inherited members to expand.`
        });
        return scopedCandidates;
    }

    for (let inheritanceEntry of inheritanceChain)
    {
        for (let candidate of candidates)
        {
            let entry = candidate.entry;
            if (entry.kind != 'method' && entry.kind != 'property')
                continue;
            if (entry.declaringTypeQualifiedName != inheritanceEntry.qualifiedName)
                continue;
            if (entry.overrideKey && seenOverrideKeys.has(entry.overrideKey))
                continue;

            if (entry.overrideKey)
                seenOverrideKeys.add(entry.overrideKey);

            scopedCandidates.push({
                entry,
                scopeRelationship: 'inherited',
                scopeDistance: inheritanceEntry.distance
            });
        }
    }

    return scopedCandidates;
}

function getScopeInheritanceChain(dbType: typedb.DBType) : Array<{ qualifiedName: string; distance: number }>
{
    let result: Array<{ qualifiedName: string; distance: number }> = [];
    let seen = new Set<string>();
    let current = dbType;
    let distance = 0;

    while (true)
    {
        let parent = resolveDirectSuperType(current);
        if (!parent)
            break;

        let qualifiedName = parent.getQualifiedTypenameInNamespace(null);
        if (seen.has(qualifiedName))
            break;

        seen.add(qualifiedName);
        distance += 1;
        result.push({
            qualifiedName,
            distance
        });
        current = parent;
    }

    return result;
}

function getMixinScopeDistance(
    entry: SearchIndexEntry,
    typeDistanceByQualifiedName: Map<string, number>
) : number | null
{
    if (!entry.isMixin || !entry.mixinTargetQualifiedName)
        return null;

    let distance = typeDistanceByQualifiedName.get(entry.mixinTargetQualifiedName);
    return typeof distance == 'number' ? distance : null;
}

function resolveDirectSuperType(dbType: typedb.DBType) : typedb.DBType | null
{
    if (!dbType)
        return null;
    if (dbType.supertype)
    {
        let superType = typedb.LookupType(dbType.namespace, dbType.supertype) ?? typedb.GetTypeByName(dbType.supertype);
        if (superType)
            return superType;
    }
    if (dbType.unrealsuper)
    {
        let unrealSuper = typedb.LookupType(dbType.namespace, dbType.unrealsuper) ?? typedb.GetTypeByName(dbType.unrealsuper);
        if (unrealSuper)
            return unrealSuper;
    }
    return null;
}

function filterCandidate(entry: SearchIndexEntry, params: NormalizedSearchParams) : boolean
{
    if (!params.kinds.has(entry.kind))
        return false;
    if (params.source != 'both' && entry.filterSource != 'both' && entry.filterSource != params.source)
        return false;
    return true;
}

function isTinySmartQuery(query: string) : boolean
{
    return compactSearchText(query).length < QUERY_TOO_SHORT_THRESHOLD;
}

function rankCandidates(candidates: SearchCandidate[], params: NormalizedSearchParams) : SearchCandidate[]
{
    if (params.mode == 'regex')
    {
        let regex = buildRegex(params.query);
        return candidates
            .filter((candidate) => matchesRegex(candidate.entry, regex))
            .sort((left, right) => compareCandidates(left, right, 0, 0));
    }

    let query = createNormalizedQuery(params.query);
    let scored = new Array<{ candidate: SearchCandidate; score: number }>();

    for (let candidate of candidates)
    {
        let score = params.mode == 'exact'
            ? scoreExactMatch(candidate.entry, query)
            : scoreSmartMatch(candidate.entry, query);
        if (score == null)
            continue;
        scored.push({
            candidate,
            score: score + candidateScopeScoreBias(candidate)
        });
    }

    scored.sort((left, right) => compareCandidates(left.candidate, right.candidate, left.score, right.score));
    return scored.map((entry) => entry.candidate);
}

function compareCandidates(left: SearchCandidate, right: SearchCandidate, leftScore: number, rightScore: number) : number
{
    if (leftScore != rightScore)
        return rightScore - leftScore;

    let leftKindOrder = kindOrder[left.entry.kind] ?? 999;
    let rightKindOrder = kindOrder[right.entry.kind] ?? 999;
    if (leftKindOrder != rightKindOrder)
        return leftKindOrder - rightKindOrder;

    let leftRelationshipOrder = getScopeRelationshipOrder(left.scopeRelationship);
    let rightRelationshipOrder = getScopeRelationshipOrder(right.scopeRelationship);
    if (leftRelationshipOrder != rightRelationshipOrder)
        return leftRelationshipOrder - rightRelationshipOrder;

    let leftDistance = left.scopeDistance ?? 0;
    let rightDistance = right.scopeDistance ?? 0;
    if (leftDistance != rightDistance)
        return leftDistance - rightDistance;

    if (left.entry.qualifiedName.length != right.entry.qualifiedName.length)
        return left.entry.qualifiedName.length - right.entry.qualifiedName.length;

    return left.entry.qualifiedName.localeCompare(right.entry.qualifiedName);
}

function createNormalizedQuery(query: string) : NormalizedQuery
{
    return {
        raw: query,
        rawLower: query.toLowerCase(),
        tokens: tokenizeSearchText(query),
        compact: compactSearchText(query)
    };
}

function scoreExactMatch(entry: SearchIndexEntry, query: NormalizedQuery) : number | null
{
    if (entry.shortName == query.raw)
        return 1600;
    if (entry.qualifiedName == query.raw)
        return 1580;
    if (entry.shortNameLower == query.rawLower)
        return 1560;
    if (entry.qualifiedNameLower == query.rawLower)
        return 1540;

    for (let alias of entry.qualifiedAliasTexts)
    {
        if (alias.text == query.raw)
            return 1520;
        if (alias.textLower == query.rawLower)
            return 1500;
    }

    return null;
}

function scoreSmartMatch(entry: SearchIndexEntry, query: NormalizedQuery) : number | null
{
    if (query.compact.length == 0)
        return null;

    if (entry.shortName == query.raw)
        return 1500 + scopeBias(entry);
    if (entry.qualifiedName == query.raw)
        return 1480 + scopeBias(entry);
    if (entry.shortNameLower == query.rawLower)
        return 1460 + scopeBias(entry);
    if (entry.qualifiedNameLower == query.rawLower)
        return 1440 + scopeBias(entry);

    let score = Math.max(
        scoreCompactMatch(entry.shortCompact, query.compact, 1400),
        scoreCompactMatch(entry.qualifiedCompact, query.compact, 1360),
        scoreInitialsMatch(entry.shortInitials, query.compact, 1340),
        scoreInitialsMatch(entry.qualifiedInitials, query.compact, 1320),
        scoreTokenMatch(entry.shortTokens, query.tokens, 1280, true, true),
        scoreTokenMatch(entry.qualifiedTokens, query.tokens, 1240, true, true),
        scoreTokenMatch(entry.shortTokens, query.tokens, 1180, false, true),
        scoreTokenMatch(entry.qualifiedTokens, query.tokens, 1140, false, true),
        scoreTokenMatch(entry.shortTokens, query.tokens, 1080, true, false),
        scoreTokenMatch(entry.qualifiedTokens, query.tokens, 1040, true, false),
        scoreTokenMatch(entry.shortTokens, query.tokens, 980, false, false),
        scoreTokenMatch(entry.qualifiedTokens, query.tokens, 940, false, false),
        scoreContainsMatch(entry.shortNameLower, query.rawLower, 900),
        scoreContainsMatch(entry.qualifiedNameLower, query.rawLower, 860)
    );

    for (let alias of entry.qualifiedAliasTexts)
    {
        score = Math.max(
            score,
            scoreExactVariant(alias, query, 1420, 1400),
            scoreCompactMatch(alias.compact, query.compact, 1340),
            scoreInitialsMatch(alias.initials, query.compact, 1300),
            scoreTokenMatch(alias.tokens, query.tokens, 1220, true, true),
            scoreTokenMatch(alias.tokens, query.tokens, 1120, false, true),
            scoreTokenMatch(alias.tokens, query.tokens, 1020, true, false),
            scoreTokenMatch(alias.tokens, query.tokens, 920, false, false),
            scoreContainsMatch(alias.textLower, query.rawLower, 880)
        );
    }

    if (score == Number.NEGATIVE_INFINITY)
        return null;
    return score + scopeBias(entry);
}

function scopeBias(entry: SearchIndexEntry) : number
{
    if (entry.kind == 'class' || entry.kind == 'struct' || entry.kind == 'enum')
        return 12;
    if (entry.kind == 'method' || entry.kind == 'function')
        return 8;
    return 4;
}

function scoreExactVariant(variant: SearchTextVariant, query: NormalizedQuery, exactScore: number, caseInsensitiveScore: number) : number
{
    if (variant.text == query.raw)
        return exactScore;
    if (variant.textLower == query.rawLower)
        return caseInsensitiveScore;
    return Number.NEGATIVE_INFINITY;
}

function matchesRegex(entry: SearchIndexEntry, regex: RegExp) : boolean
{
    if (regexTest(regex, entry.shortName) || regexTest(regex, entry.qualifiedName))
        return true;
    return entry.qualifiedAliasTexts.some((alias) => regexTest(regex, alias.text));
}

function candidateScopeScoreBias(candidate: SearchCandidate) : number
{
    let distancePenalty = Math.min(candidate.scopeDistance ?? 0, 4) * 2;
    if (candidate.scopeRelationship == 'declared')
        return 24 - distancePenalty;
    if (candidate.scopeRelationship == 'mixin')
        return 16 - distancePenalty;
    if (candidate.scopeRelationship == 'inherited')
        return 8 - distancePenalty;
    return 0;
}

function getScopeRelationshipOrder(value: ApiSearchScopeRelationship | undefined) : number
{
    if (value == 'declared')
        return 0;
    if (value == 'mixin')
        return 1;
    if (value == 'inherited')
        return 2;
    return 3;
}

function scoreCompactMatch(candidateCompact: string, queryCompact: string, baseScore: number) : number
{
    if (candidateCompact == queryCompact)
        return baseScore;
    if (candidateCompact.startsWith(queryCompact))
        return baseScore - Math.min(40, candidateCompact.length - queryCompact.length);
    if (candidateCompact.includes(queryCompact))
        return baseScore - 80 - candidateCompact.indexOf(queryCompact);
    return Number.NEGATIVE_INFINITY;
}

function scoreInitialsMatch(candidateInitials: string, queryCompact: string, baseScore: number) : number
{
    if (queryCompact.length < QUERY_TOO_SHORT_THRESHOLD || candidateInitials.length == 0)
        return Number.NEGATIVE_INFINITY;
    if (candidateInitials == queryCompact)
        return baseScore;
    if (candidateInitials.startsWith(queryCompact))
        return baseScore - Math.min(20, candidateInitials.length - queryCompact.length);
    return Number.NEGATIVE_INFINITY;
}

function scoreTokenMatch(
    candidateTokens: string[],
    queryTokens: string[],
    baseScore: number,
    prefixOnly: boolean,
    ordered: boolean
) : number
{
    if (queryTokens.length == 0 || candidateTokens.length == 0)
        return Number.NEGATIVE_INFINITY;

    let matchIndices = ordered
        ? matchOrderedTokens(candidateTokens, queryTokens, prefixOnly)
        : matchUnorderedTokens(candidateTokens, queryTokens, prefixOnly);
    if (!matchIndices)
        return Number.NEGATIVE_INFINITY;

    let firstIndex = matchIndices[0] ?? 0;
    let densityPenalty = matchIndices[matchIndices.length - 1] - firstIndex;
    return baseScore - (firstIndex * 4) - densityPenalty;
}

function scoreContainsMatch(candidateText: string, queryText: string, baseScore: number) : number
{
    let index = candidateText.indexOf(queryText);
    if (index == -1)
        return Number.NEGATIVE_INFINITY;
    return baseScore - index;
}

function matchOrderedTokens(candidateTokens: string[], queryTokens: string[], prefixOnly: boolean) : number[] | null
{
    let matchIndices: number[] = [];
    let searchIndex = 0;
    for (let queryToken of queryTokens)
    {
        let found = -1;
        for (let index = searchIndex; index < candidateTokens.length; index += 1)
        {
            if (tokenMatches(candidateTokens[index], queryToken, prefixOnly))
            {
                found = index;
                break;
            }
        }
        if (found == -1)
            return null;

        matchIndices.push(found);
        searchIndex = found + 1;
    }

    return matchIndices;
}

function matchUnorderedTokens(candidateTokens: string[], queryTokens: string[], prefixOnly: boolean) : number[] | null
{
    let used = new Set<number>();
    let matchIndices: number[] = [];
    for (let queryToken of queryTokens)
    {
        let found = -1;
        for (let index = 0; index < candidateTokens.length; index += 1)
        {
            if (used.has(index))
                continue;
            if (!tokenMatches(candidateTokens[index], queryToken, prefixOnly))
                continue;
            found = index;
            break;
        }
        if (found == -1)
            return null;

        used.add(found);
        matchIndices.push(found);
    }

    matchIndices.sort((left, right) => left - right);
    return matchIndices;
}

function tokenMatches(candidateToken: string, queryToken: string, prefixOnly: boolean) : boolean
{
    if (prefixOnly)
        return candidateToken.startsWith(queryToken);
    return candidateToken.includes(queryToken);
}

function buildMatch(candidate: SearchCandidate) : GetAPISearchMatch
{
    let match: GetAPISearchMatch = {
        qualifiedName: candidate.entry.qualifiedName,
        kind: candidate.entry.kind,
        signature: candidate.entry.signature,
        source: candidate.entry.source
    };

    if (candidate.entry.summary)
        match.summary = candidate.entry.summary;
    if (candidate.entry.containerQualifiedName)
        match.containerQualifiedName = candidate.entry.containerQualifiedName;
    if (candidate.entry.isMixin)
        match.isMixin = true;
    if (candidate.scopeRelationship)
        match.scopeRelationship = candidate.scopeRelationship;
    if (typeof candidate.scopeDistance === 'number')
        match.scopeDistance = candidate.scopeDistance;
    if (candidate.entry.detailsData !== undefined)
        match.detailsData = candidate.entry.detailsData;

    return match;
}

function isEntryWithinNamespaceScope(entry: SearchIndexEntry, namespaceQualifiedName: string) : boolean
{
    if (entry.declaringTypeQualifiedName)
        return entry.declaringTypeQualifiedName.startsWith(namespaceQualifiedName + '::');

    if (entry.kind == 'class' || entry.kind == 'struct' || entry.kind == 'enum')
        return entry.qualifiedName.startsWith(namespaceQualifiedName + '::');

    if (entry.namespaceQualifiedName.length == 0)
        return false;

    return entry.namespaceQualifiedName == namespaceQualifiedName || entry.namespaceQualifiedName.startsWith(namespaceQualifiedName + '::');
}

function isNamespaceApiEmpty(namespace: typedb.DBNamespace) : boolean
{
    return namespace.childNamespaces.size == 0 && namespace.symbols.size == 0;
}

function shouldIncludeTypeInSearch(dbType: typedb.DBType) : boolean
{
    return !dbType.isDelegate
        && !dbType.isEvent
        && !dbType.isPrimitive
        && !dbType.isTemplateInstantiation;
}

function shouldSkipMethod(method: typedb.DBMethod) : boolean
{
    if (method.isConstructor && (!method.args || method.args.length == 0))
        return true;
    if (method.isConstructor && method.args && method.args.length == 1)
        return true;
    if (method.isConstructor)
    {
        let ctorType = getConstructorOwnerType(method);
        if (ctorType && (ctorType.isDelegate || ctorType.isEvent))
            return true;
    }
    if (method.name.startsWith('op'))
        return true;
    return false;
}

function getConstructorOwnerType(method: typedb.DBMethod) : typedb.DBType | null
{
    if (method.containingType)
        return method.containingType;

    if (method.namespace)
    {
        let shadowed = method.namespace.getShadowedType();
        if (shadowed)
            return shadowed;
    }

    if (method.returnType)
    {
        let lookupNamespace = method.namespace;
        if (lookupNamespace && lookupNamespace.isRootNamespace())
            lookupNamespace = null;
        let found = typedb.LookupType(lookupNamespace, method.returnType);
        if (found)
            return found;
        found = typedb.GetTypeByName(method.returnType);
        if (found)
            return found;
    }

    if (method.name)
    {
        let found = typedb.GetTypeByName(method.name);
        if (found)
            return found;
    }

    return null;
}

function buildMethodSignature(method: typedb.DBMethod) : string
{
    if (method.containingType)
        return method.format(method.containingType.getQualifiedTypenameInNamespace(null) + '.');
    if (method.isMixin && method.args && method.args.length > 0)
        return method.format(method.args[0].typename + '.', true);
    if (method.namespace && !method.namespace.isRootNamespace())
        return method.format(method.namespace.getQualifiedNamespace() + '::');
    return method.format();
}

function getMixinTargetQualifiedName(method: typedb.DBMethod) : string | undefined
{
    if (!method.isMixin || !method.args || method.args.length == 0)
        return undefined;

    let mixinTargetName = typedb.CleanTypeName(method.args[0].typename);
    let lookupNamespace = method.namespace;
    if (lookupNamespace && lookupNamespace.isRootNamespace())
        lookupNamespace = null;

    let mixinTarget = typedb.LookupType(lookupNamespace, mixinTargetName) ?? typedb.GetTypeByName(mixinTargetName);
    if (mixinTarget)
        return mixinTarget.getQualifiedTypenameInNamespace(null);

    return mixinTargetName.length > 0 ? mixinTargetName : undefined;
}

function buildTypeSignature(dbType: typedb.DBType) : string
{
    let kind = dbType.isEnum ? 'enum' : (dbType.isStruct ? 'struct' : 'class');
    return `${kind} ${dbType.getQualifiedTypenameInNamespace(null)}`;
}

function buildMethodOverrideKey(method: typedb.DBMethod) : string
{
    let args = method.args ? method.args.map((arg) => typedb.CleanTypeName(arg.typename)).join(',') : '';
    return `method|${method.name}|${typedb.CleanTypeName(method.returnType ?? 'void')}|${args}`;
}

function buildPropertyOverrideKey(property: typedb.DBProperty) : string
{
    return `property|${property.name}`;
}

function getTypeKind(dbType: typedb.DBType) : 'class' | 'struct' | 'enum'
{
    if (dbType.isEnum)
        return 'enum';
    if (dbType.isStruct)
        return 'struct';
    return 'class';
}

function isClassType(dbType: typedb.DBType) : boolean
{
    return !dbType.isPrimitive
        && !dbType.isEnum
        && !dbType.isStruct
        && !dbType.isDelegate
        && !dbType.isEvent;
}

function getDeclaredSource(declaredModule: string | null | undefined) : ApiSearchMatchSource
{
    return typeof declaredModule == 'string' && declaredModule.length > 0 ? 'script' : 'native';
}

function getNamespaceSource(namespace: typedb.DBNamespace) : { source: ApiSearchMatchSource; filterSource: ApiSearchSource }
{
    let hasScript = false;
    let hasNative = false;
    for (let declaration of namespace.declarations)
    {
        if (typeof declaration.declaredModule == 'string' && declaration.declaredModule.length > 0)
            hasScript = true;
        else
            hasNative = true;
    }

    if (hasScript && hasNative)
    {
        return {
            source: 'script',
            filterSource: 'both'
        };
    }

    if (hasScript)
    {
        return {
            source: 'script',
            filterSource: 'script'
        };
    }

    return {
        source: 'native',
        filterSource: 'native'
    };
}

function extractSummary(documentation: string | null | undefined) : string | undefined
{
    if (!documentation)
        return undefined;

    let lines = documentation
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length == 0)
        return undefined;

    let summary = lines[0];
    if (summary.length > 220)
        return summary.substring(0, 217) + '...';
    return summary;
}

function createSearchTextVariant(value: string) : SearchTextVariant
{
    let tokens = tokenizeSearchText(value);
    return {
        text: value,
        textLower: value.toLowerCase(),
        tokens,
        compact: compactSearchText(value),
        initials: tokensToInitials(tokens)
    };
}

function dedupeSearchTextVariants(values: string[] | undefined, canonicalTextLower: string) : SearchTextVariant[]
{
    if (!values || values.length == 0)
        return [];

    let seen = new Set<string>([canonicalTextLower]);
    let result: SearchTextVariant[] = [];
    for (let value of values)
    {
        let trimmed = value.trim();
        if (trimmed.length == 0)
            continue;

        let normalized = trimmed.toLowerCase();
        if (seen.has(normalized))
            continue;

        seen.add(normalized);
        result.push(createSearchTextVariant(trimmed));
    }

    return result;
}

function getShortName(qualifiedName: string, kind: ApiSearchKind) : string
{
    let dotIndex = qualifiedName.lastIndexOf('.');
    if (dotIndex != -1 && (kind == 'method' || kind == 'property'))
        return qualifiedName.substring(dotIndex + 1);

    let namespaceIndex = qualifiedName.lastIndexOf('::');
    if (namespaceIndex != -1)
        return qualifiedName.substring(namespaceIndex + 2);

    return qualifiedName;
}

function tokenizeSearchText(value: string) : string[]
{
    if (!value)
        return [];

    let normalized = value
        .replace(/::/g, ' ')
        .replace(/[._]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (normalized.length == 0)
        return [];

    let segments = normalized.split(' ');
    let tokens: string[] = [];
    for (let segment of segments)
    {
        let parts = segment.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g);
        if (!parts || parts.length == 0)
        {
            let lowered = segment.toLowerCase();
            if (lowered.length > 0)
                tokens.push(lowered);
            continue;
        }

        for (let part of parts)
        {
            let lowered = part.toLowerCase();
            if (lowered.length > 0)
                tokens.push(lowered);
        }
    }
    return tokens;
}

function compactSearchText(value: string) : string
{
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokensToInitials(tokens: string[]) : string
{
    return tokens
        .map((token) => token.length > 0 ? token[0] : '')
        .join('');
}

type ParsedRegex = {
    pattern: string;
    flags: string;
};

function parseRegexPattern(raw: string) : ParsedRegex
{
    if (raw.length >= 2 && raw.startsWith('/') && raw.lastIndexOf('/') > 0)
    {
        let lastSlash = raw.lastIndexOf('/');
        return {
            pattern: raw.substring(1, lastSlash),
            flags: raw.substring(lastSlash + 1)
        };
    }

    return {
        pattern: raw,
        flags: 'i'
    };
}

function buildRegex(rawPattern: string) : RegExp
{
    try
    {
        let parsed = parseRegexPattern(rawPattern);
        if (parsed.flags && !/^[dgimsuvy]*$/.test(parsed.flags))
            throw new Error(`Invalid regex flags "${parsed.flags}".`);
        return new RegExp(parsed.pattern, parsed.flags);
    }
    catch (error)
    {
        let message = error instanceof Error ? error.message : String(error);
        throw new ApiSearchValidationError(`Invalid params. 'query' is not a valid regex. ${message}`);
    }
}

function regexTest(regex: RegExp, text: string) : boolean
{
    if (regex.global || regex.sticky)
        regex.lastIndex = 0;
    return regex.test(text);
}
