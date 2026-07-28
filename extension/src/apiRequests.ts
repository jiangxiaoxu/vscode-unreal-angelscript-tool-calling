import { RequestType, RequestType0 } from 'vscode-languageserver-protocol/node';
import type { TextDocumentPositionParams } from 'vscode-languageserver-protocol';
export const GetUnrealConnectionStatusRequest = new RequestType0<boolean, void>('angelscript/getUnrealConnectionStatus');
export const ProvideInlineValuesRequest = new RequestType<TextDocumentPositionParams, any[], void>('angelscript/provideInlineValues');
export const GetAPIRequest = new RequestType<any, any[], void>('angelscript/getAPI');
export const GetAPIDetailsRequest = new RequestType<any, string, void>('angelscript/getAPIDetails');
export const GetAPIDetailsBatchRequest = new RequestType<any[], string[], void>('angelscript/getAPIDetailsBatch');

export type SearchMode = 'smart' | 'regex';
export type SearchSource = 'native' | 'script' | 'both';
export type SearchMatchSource = 'native' | 'script';
export type SearchKind = 'class' | 'struct' | 'enum' | 'method' | 'function' | 'property' | 'globalVariable';
export type SearchScopeKind = 'namespace' | 'class' | 'struct' | 'enum';
export type SearchScopeRelationship = 'declared' | 'inherited' | 'mixin';
export type SearchMatchReason = 'exact-qualified' | 'exact-short' | 'boundary-ordered' | 'ordered-wildcard' | 'short-ordered';
export type SearchIncludeInheritedFromScopeMode = 'auto' | 'explicit';
export type SearchSymbolLevel = 'all' | 'type';
export type SearchMatchedBy = 'self' | 'member' | 'mixin';

export type GetAPISearchParams = {
    query: string;
    mode?: SearchMode;
    limit?: number;
    offset?: number;
    kinds?: SearchKind[];
    source?: SearchSource;
    scope?: string;
    includeInheritedFromScope?: boolean;
    includeDocs?: boolean;
    symbolLevel?: SearchSymbolLevel;
};

export type GetAPISearchNotice = {
    code: string;
    message: string;
};

export type InheritedScopeOutcome =
    | 'applied'
    | 'ignored_missing_scope'
    | 'ignored_scope_not_found'
    | 'ignored_scope_not_class'
    | 'ignored_scope_ambiguous';

export type GetAPISearchScopeLookup = {
    requestedScope: string;
    resolvedQualifiedName?: string;
    resolvedKind?: SearchScopeKind;
    ambiguousCandidates?: string[];
};

export type GetAPISearchResolvedScope = {
    requestedScope: string;
    resolvedQualifiedName: string;
    resolvedKind: SearchScopeKind;
};

export type GetAPISearchLspMatch = {
    qualifiedName: string;
    kind: SearchKind;
    signature: string;
    matchReason?: SearchMatchReason;
    summary?: string;
    documentation?: string;
    containerQualifiedName?: string;
    source: SearchMatchSource;
    isMixin?: boolean;
    scopeRelationship?: SearchScopeRelationship;
    scopeDistance?: number;
    matchedBy?: SearchMatchedBy;
    matchedByQualifiedName?: string;
    matchedByKind?: SearchKind;
    detailsData?: unknown;
};

export type GetAPISearchMatchCounts = {
    total: number;
    returned: number;
    omitted: number;
};

export type GetAPISearchLspScopeGroup = {
    scope: GetAPISearchResolvedScope;
    matches: GetAPISearchLspMatch[];
    totalMatches: number;
    omittedMatches: number;
};

export type GetAPISearchLspResult = {
    matches: GetAPISearchLspMatch[];
    matchCounts: GetAPISearchMatchCounts;
    notices?: GetAPISearchNotice[];
    scopeLookup?: GetAPISearchScopeLookup;
    scopeGroups?: GetAPISearchLspScopeGroup[];
    inheritedScopeOutcome?: InheritedScopeOutcome;
};

export const GetAPISearchRequest = new RequestType<GetAPISearchParams, GetAPISearchLspResult, void>('angelscript/getAPISearch');
