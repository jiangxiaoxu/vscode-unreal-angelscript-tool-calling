import { RequestType, RequestType0, TextDocumentPositionParams } from 'vscode-languageclient/node';
import { SearchSource } from './angelscriptApiSearch';

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
export type GetAPISearchParams = {
    filter: string;
    source?: SearchSource;
};
export const GetAPISearchRequest = new RequestType<GetAPISearchParams, any[], void>('angelscript/getAPISearch');
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
        };
        doc?: {
            format: 'markdown' | 'plaintext';
            text: string;
        };
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

export type FindReferencesLocation = {
    filePath: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
};

export type FindReferencesItem = {
    filePath: string;
    startLine: number;
    endLine: number;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    preview: string;
};

export type FindReferencesData = {
    total: number;
    references: FindReferencesItem[];
};

export type FindReferencesResult = ToolResult<FindReferencesData>;
