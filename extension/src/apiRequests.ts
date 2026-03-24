import { RequestType, RequestType0, TextDocumentPositionParams } from 'vscode-languageclient/node';

export const GetModuleForSymbolRequest = new RequestType<TextDocumentPositionParams, string, void>('angelscript/getModuleForSymbol');
export const GetUnrealConnectionStatusRequest = new RequestType0<boolean, void>('angelscript/getUnrealConnectionStatus');
export const ProvideInlineValuesRequest = new RequestType<TextDocumentPositionParams, any[], void>('angelscript/provideInlineValues');
export const GetAPIRequest = new RequestType<any, any[], void>('angelscript/getAPI');
export const GetAPIDetailsRequest = new RequestType<any, string, void>('angelscript/getAPIDetails');
export const GetAPIDetailsBatchRequest = new RequestType<any[], string[], void>('angelscript/getAPIDetailsBatch');

export type ToolFailure = {
    ok: false;
    error: {
        code: string;
        message: string;
        retryable?: boolean;
        hint?: string;
        details?: Record<string, unknown>;
    };
};

export type ToolSuccess<TData> = {
    ok: true;
    data: TData;
};

export type ToolResult<TData> = ToolSuccess<TData> | ToolFailure;

export type SearchMode = 'smart' | 'exact' | 'regex';
export type SearchSource = 'native' | 'script' | 'both';
export type SearchMatchSource = 'native' | 'script';
export type SearchKind = 'class' | 'struct' | 'enum' | 'method' | 'function' | 'property' | 'globalVariable';
export type SearchScopeKind = 'namespace' | 'class' | 'struct' | 'enum';
export type SearchScopeRelationship = 'declared' | 'inherited' | 'mixin';

export type GetAPISearchParams = {
    query: string;
    mode?: SearchMode;
    limit?: number;
    kinds?: SearchKind[];
    source?: SearchSource;
    scopePrefix?: string;
    includeInheritedFromScope?: boolean;
    includeInternal?: boolean;
};

export type GetAPISearchNotice = {
    code: string;
    message: string;
};

export type InheritedScopeOutcome =
    | 'applied'
    | 'ignored_missing_scope_prefix'
    | 'ignored_scope_not_found'
    | 'ignored_scope_not_class'
    | 'ignored_scope_ambiguous';

export type GetAPISearchScopeLookup = {
    requestedPrefix: string;
    resolvedQualifiedName?: string;
    resolvedKind?: SearchScopeKind;
    ambiguousCandidates?: string[];
};

export type GetAPISearchLspMatch = {
    qualifiedName: string;
    kind: SearchKind;
    signature: string;
    summary?: string;
    containerQualifiedName?: string;
    source: SearchMatchSource;
    isMixin?: boolean;
    scopeRelationship?: SearchScopeRelationship;
    scopeDistance?: number;
    detailsData?: unknown;
};

export type GetAPISearchToolMatch = Omit<GetAPISearchLspMatch, 'detailsData'>;

export type GetAPISearchLspResult = {
    matches: GetAPISearchLspMatch[];
    notices?: GetAPISearchNotice[];
    scopeLookup?: GetAPISearchScopeLookup;
    inheritedScopeOutcome?: InheritedScopeOutcome;
};

export type GetAPISearchToolData = {
    matches: GetAPISearchToolMatch[];
    notices?: GetAPISearchNotice[];
    scopeLookup?: GetAPISearchScopeLookup;
    inheritedScopeOutcome?: InheritedScopeOutcome;
    request?: {
        query: string;
        mode: SearchMode;
        limit: number;
        kinds?: SearchKind[];
        source: SearchSource;
        scopePrefix?: string;
        includeInheritedFromScope: boolean;
        includeInternal: boolean;
    };
};

export type GetAPISearchResult = ToolResult<GetAPISearchToolData>;

export const GetAPISearchRequest = new RequestType<GetAPISearchParams, GetAPISearchLspResult, void>('angelscript/getAPISearch');

export type GetTypeMembersParams = {
    name: string;
    namespace?: string;
    includeInherited?: boolean;
    includeDocs?: boolean;
    kinds?: 'both' | 'method' | 'property';
};
export type TypeMemberVisibility = 'public' | 'protected' | 'private';
export type TypeMemberInfo = {
    kind: 'method' | 'property';
    name: string;
    signature: string;
    description: string;
    declaredIn: string;
    declaredInKind: 'type' | 'namespace';
    isInherited: boolean;
    isMixin: boolean;
    isAccessor: boolean;
    accessorKind?: 'get' | 'set';
    propertyName?: string;
    visibility: TypeMemberVisibility;
};
export type GetTypeMembersLspResult = {
    ok: true;
    type: {
        name: string;
        namespace: string;
        qualifiedName: string;
    };
    members: TypeMemberInfo[];
} | {
    ok: false;
    error: {
        code: 'NotFound' | 'InvalidParams';
        message: string;
    };
};

export type GetTypeMembersToolData = {
    type: {
        name: string;
        namespace: string;
        qualifiedName: string;
    };
    members: TypeMemberInfo[];
    request?: {
        name: string;
        namespace?: string;
        includeInherited: boolean;
        includeDocs: boolean;
        kinds: 'both' | 'method' | 'property';
    };
};

export type GetTypeMembersResult = ToolResult<GetTypeMembersToolData>;

export const GetTypeMembersRequest = new RequestType<GetTypeMembersParams, GetTypeMembersLspResult, void>('angelscript/getTypeMembers');
export type GetTypeHierarchyParams = {
    name: string;
    maxSuperDepth?: number;
    maxSubDepth?: number;
    maxSubBreadth?: number;
};
export type TypeHierarchyClassSource = {
    source: 'cpp';
} | {
    source: 'as';
    filePath: string;
    startLine: number;
    endLine: number;
    preview?: string;
};
export type GetTypeHierarchyLspResult = {
    ok: true;
    root: string;
    supers: string[];
    derivedByParent: Record<string, string[]>;
    sourceByClass: Record<string, TypeHierarchyClassSource>;
    limits: {
        maxSuperDepth: number;
        maxSubDepth: number;
        maxSubBreadth: number;
    };
    truncated: {
        supers: boolean;
        derivedDepth: boolean;
        derivedBreadthByClass: Record<string, number>;
    };
} | {
    ok: false;
    error: {
        code: 'NotFound' | 'InvalidParams';
        message: string;
    };
};

export type GetTypeHierarchyToolData = {
    root: string;
    supers: string[];
    derivedByParent: Record<string, string[]>;
    sourceByClass: Record<string, TypeHierarchyClassSource>;
    limits: {
        maxSuperDepth: number;
        maxSubDepth: number;
        maxSubBreadth: number;
    };
    truncated: {
        supers: boolean;
        derivedDepth: boolean;
        derivedBreadthByClass: Record<string, number>;
    };
};

export type GetTypeHierarchyResult = ToolResult<GetTypeHierarchyToolData>;

export const GetTypeHierarchyRequest = new RequestType<GetTypeHierarchyParams, GetTypeHierarchyLspResult, void>('angelscript/getTypeHierarchy');
export type ResolveSymbolAtPositionParams = {
    uri: string;
    position: {
        line: number;
        character: number;
    };
    includeDocumentation?: boolean;
};

export type ResolveSymbolAtPositionToolParams = {
    filePath: string;
    position: {
        line: number;
        character: number;
    };
    includeDocumentation?: boolean;
};

export type ResolveSymbolAtPositionToolData = {
    symbol: {
        kind: string;
        name: string;
        signature: string;
        definition?: {
            filePath: string;
            startLine: number;
            endLine: number;
            preview: string;
            matchStartLine?: number;
            matchEndLine?: number;
        };
        doc?: {
            format: 'markdown' | 'plaintext';
            text: string;
        };
    };
    request?: {
        filePath: string;
        position: {
            line: number;
            character: number;
        };
        includeDocumentation: boolean;
    };
};

export type ResolveSymbolAtPositionToolResult = ToolResult<ResolveSymbolAtPositionToolData>;

export type ResolveSymbolAtPositionResult = {
    ok: true;
    symbol: {
        kind: string;
        name: string;
        signature: string;
        definition?: {
            uri: string;
            startLine: number;
            endLine: number;
        };
        doc?: {
            format: 'markdown' | 'plaintext';
            text: string;
        };
    };
} | {
    ok: false;
    error: {
        code: 'NotFound' | 'NotReady' | 'InvalidParams' | 'Unavailable';
        message: string;
        retryable?: boolean;
        hint?: string;
    };
};

export const ResolveSymbolAtPositionRequest = new RequestType<ResolveSymbolAtPositionParams, ResolveSymbolAtPositionResult, void>('angelscript/resolveSymbolAtPosition');

export type FindReferencesParams = {
    filePath: string;
    position: {
        line: number;
        character: number;
    };
};

// Tool-facing range with 1-based line/character indices.
export type FindReferencesRange = {
    start: { line: number; character: number };
    end: { line: number; character: number };
};

export type FindReferencesLocation = {
    filePath: string;
    range: FindReferencesRange;
};

export type FindReferencesItem = {
    filePath: string;
    startLine: number;
    endLine: number;
    range: FindReferencesRange;
    preview: string;
};

export type FindReferencesData = {
    total: number;
    references: FindReferencesItem[];
    request?: {
        filePath: string;
        position: {
            line: number;
            character: number;
        };
    };
};

export type FindReferencesResult = ToolResult<FindReferencesData>;
