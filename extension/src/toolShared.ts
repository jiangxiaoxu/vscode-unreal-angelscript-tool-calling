import { LanguageClient } from 'vscode-languageclient/node';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'path';
import {
    AngelscriptSearchParams,
    ApiErrorPayload,
    ApiResponsePayload,
    SearchSource,
    buildSearchPayload,
    toApiErrorPayload
} from './angelscriptApiSearch';
import {
    GetTypeMembersParams,
    GetTypeMembersRequest,
    GetTypeMembersResult,
    GetTypeHierarchyParams,
    GetTypeHierarchyRequest,
    GetTypeHierarchyResult,
    FindReferencesParams,
    FindReferencesResult,
    FindReferencesLocation,
    ResolveSymbolAtPositionToolParams,
    ResolveSymbolAtPositionToolResult,
    ResolveSymbolAtPositionRequest,
    ResolveSymbolAtPositionResult
} from './apiRequests';

export type ToolErrorPayload = ApiErrorPayload;
export type SearchOutputPayload = ApiResponsePayload & {
    text?: string;
    request?: Record<string, unknown>;
};

type LspLocation = {
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
};

function resolveFilePathInput(filePath: string): { filePath: string; uri: string } | null
{
    const absolutePath = path.normalize(filePath.trim());
    try
    {
        return { filePath: absolutePath, uri: pathToFileURL(absolutePath).toString() };
    }
    catch
    {
        return null;
    }
}

function fileUriToAbsolutePath(uri: string): string | null
{
    if (!uri.startsWith('file://'))
        return null;
    try
    {
        return path.normalize(fileURLToPath(uri));
    }
    catch
    {
        return null;
    }
}

export function isErrorPayload(value: unknown): value is ApiErrorPayload
{
    if (!value || typeof value !== 'object')
        return false;
    const maybe = value as { ok?: unknown; error?: { code?: unknown } };
    return maybe.ok === false && typeof maybe.error?.code === 'string';
}

export function formatSearchPayloadForOutput(
    payload: ApiResponsePayload,
    input: Partial<AngelscriptSearchParams> | null | undefined
): SearchOutputPayload
{
    if (!payload.items || payload.items.length > 0)
        return payload;

    const labelQuery = typeof input?.labelQuery === 'string' ? input.labelQuery.trim() : payload.labelQuery;
    const searchIndex = Number.isFinite(Number(input?.searchIndex)) ? Number(input?.searchIndex) : payload.searchIndex;
    const maxBatchResults = typeof input?.maxBatchResults === 'number' ? input?.maxBatchResults : 200;
    const request: Record<string, unknown> = {
        labelQuery,
        searchIndex,
        maxBatchResults,
        kinds: input?.kinds,
        source: input?.source ?? 'both',
        labelQueryUseRegex: input?.labelQueryUseRegex === true
    };
    const signatureRegex = typeof input?.signatureRegex === 'string' ? input.signatureRegex.trim() : '';
    if (signatureRegex)
    {
        request.signatureRegex = signatureRegex;
    }
    return {
        ...payload,
        text: `No Angelscript API results for "${labelQuery}".`,
        request
    };
}

function makeError(code: string, message: string, details?: Record<string, unknown>): ApiErrorPayload
{
    return {
        ok: false,
        error: {
            code,
            message,
            details
        }
    };
}

export async function runSearchApi(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown,
    shouldCancel?: () => boolean
): Promise<ApiResponsePayload | ApiErrorPayload>
{
    const raw = input as Partial<AngelscriptSearchParams> | null | undefined;
    const labelQuery = typeof raw?.labelQuery === 'string' ? raw.labelQuery.trim() : '';
    if (!labelQuery)
    {
        return makeError('MISSING_LABEL_QUERY', 'Missing labelQuery. Please provide labelQuery.');
    }
    const searchIndex = Number(raw?.searchIndex);
    const maxBatchResults = typeof raw?.maxBatchResults === 'number' ? raw.maxBatchResults : undefined;
    const source = typeof raw?.source === 'string' ? raw.source : undefined;
    const kinds = Array.isArray(raw?.kinds) ? raw?.kinds : undefined;

    try
    {
        await startedClient;
        const payload = await buildSearchPayload(
            client,
            {
                labelQuery,
                searchIndex,
                maxBatchResults,
                includeDocs: raw?.includeDocs,
                kinds,
                source: source as SearchSource | undefined,
                labelQueryUseRegex: raw?.labelQueryUseRegex,
                signatureRegex: raw?.signatureRegex
            },
            shouldCancel ?? (() => false)
        );
        return payload;
    }
    catch (error)
    {
        const apiError = toApiErrorPayload(error);
        if (apiError)
            return apiError;
        console.error("angelscript_searchApi tool failed:", error);
        return makeError('INTERNAL_ERROR', 'The Angelscript API tool failed to run. Please ensure the language server is running and try again.');
    }
}

export async function runResolveSymbolAtPosition(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown
): Promise<ResolveSymbolAtPositionToolResult | ApiErrorPayload>
{
    const raw = input as ResolveSymbolAtPositionToolParams | null | undefined;
    const filePath = raw?.filePath;
    const position = raw?.position;
    const line = position?.line;
    const character = position?.character;

    if (typeof filePath !== 'string' || typeof line !== 'number' || typeof character !== 'number')
    {
        return makeError('InvalidParams', 'Invalid params. Provide filePath and position { line, character }.');
    }
    const trimmedPath = filePath.trim();
    if (trimmedPath.startsWith('file://'))
    {
        return makeError('InvalidParams', "Invalid params. 'filePath' must be an absolute path without the file:// scheme.");
    }
    if (!path.isAbsolute(trimmedPath))
    {
        return makeError('InvalidParams', "Invalid params. 'filePath' must be an absolute path.");
    }
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0)
    {
        return makeError('InvalidParams', "Invalid params. 'line' and 'character' must be non-negative integers.");
    }

    const includeDocumentation = raw?.includeDocumentation !== false;

    try
    {
        await startedClient;
        const resolved = resolveFilePathInput(trimmedPath);
        if (!resolved)
        {
            return makeError('INTERNAL_ERROR', 'Failed to convert filePath to file URI.');
        }
        return await client.sendRequest(
            ResolveSymbolAtPositionRequest,
            {
                uri: resolved.uri,
                position: { line, character },
                includeDocumentation
            }
        ).then((result) =>
        {
            const lspResult = result as ResolveSymbolAtPositionResult;
            if (!lspResult || lspResult.ok === false)
                return lspResult as ResolveSymbolAtPositionToolResult;

            const definition = lspResult.symbol.definition;
            if (definition && !definition.uri.startsWith('file://'))
            {
                return makeError('INTERNAL_ERROR', 'Language server returned a non-file path for definition.');
            }
            const absoluteDefinitionPath = definition ? fileUriToAbsolutePath(definition.uri) : null;
            if (definition && !absoluteDefinitionPath)
            {
                return makeError('INTERNAL_ERROR', 'Failed to resolve definition file path from language server result.');
            }
            const mappedDefinition = (definition && absoluteDefinitionPath)
                ? {
                    filePath: absoluteDefinitionPath,
                    startLine: definition.startLine,
                    endLine: definition.endLine
                }
                : undefined;

            return {
                ok: true,
                symbol: {
                    kind: lspResult.symbol.kind,
                    name: lspResult.symbol.name,
                    signature: lspResult.symbol.signature,
                    definition: mappedDefinition,
                    doc: lspResult.symbol.doc
                }
            } as ResolveSymbolAtPositionToolResult;
        });
    }
    catch (error)
    {
        console.error("angelscript_resolveSymbolAtPosition tool failed:", error);
        return makeError('INTERNAL_ERROR', 'The resolveSymbolAtPosition tool failed to run. Please ensure the language server is running and try again.');
    }
}

export async function runGetTypeMembers(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown
): Promise<GetTypeMembersResult | ApiErrorPayload>
{
    const raw = input as GetTypeMembersParams | null | undefined;
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name)
    {
        return makeError('InvalidParams', "Invalid params. 'name' must be a non-empty string.");
    }

    const namespace = typeof raw?.namespace === 'string' ? raw.namespace.trim() : undefined;
    const includeInherited = raw?.includeInherited === true;
    const includeDocs = raw?.includeDocs === true;
    const kinds = typeof raw?.kinds === 'string' ? raw.kinds.trim() : undefined;

    try
    {
        await startedClient;
        return await client.sendRequest<GetTypeMembersResult>(
            GetTypeMembersRequest.method,
            {
                name,
                namespace,
                includeInherited,
                includeDocs,
                kinds
            }
        ) as GetTypeMembersResult;
    }
    catch (error)
    {
        console.error("angelscript_getTypeMembers tool failed:", error);
        return makeError('INTERNAL_ERROR', 'The angelscript_getTypeMembers tool failed to run. Please ensure the language server is running and try again.');
    }
}

export async function runGetTypeHierarchy(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown
): Promise<GetTypeHierarchyResult | ApiErrorPayload>
{
    const raw = input as GetTypeHierarchyParams | null | undefined;
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name)
    {
        return makeError('InvalidParams', "Invalid params. 'name' must be a non-empty string.");
    }

    const maxSuperDepth = typeof raw?.maxSuperDepth === 'number' ? raw.maxSuperDepth : undefined;
    const maxSubDepth = typeof raw?.maxSubDepth === 'number' ? raw.maxSubDepth : undefined;
    if (maxSuperDepth !== undefined)
    {
        if (!Number.isInteger(maxSuperDepth) || maxSuperDepth < 0)
        {
            return makeError('InvalidParams', "Invalid params. 'maxSuperDepth' must be a non-negative integer.");
        }
    }
    if (maxSubDepth !== undefined)
    {
        if (!Number.isInteger(maxSubDepth) || maxSubDepth < 0)
        {
            return makeError('InvalidParams', "Invalid params. 'maxSubDepth' must be a non-negative integer.");
        }
    }
    if ((maxSuperDepth ?? 5) === 0 && (maxSubDepth ?? 8) === 0)
    {
        return makeError('InvalidParams', "Invalid params. 'maxSuperDepth' and 'maxSubDepth' cannot both be 0.");
    }

    try
    {
        await startedClient;
        return await client.sendRequest<GetTypeHierarchyResult>(
            GetTypeHierarchyRequest.method,
            {
                name,
                maxSuperDepth,
                maxSubDepth
            }
        ) as GetTypeHierarchyResult;
    }
    catch (error)
    {
        console.error("angelscript_getClassHierarchy tool failed:", error);
        return makeError('INTERNAL_ERROR', 'The angelscript_getClassHierarchy tool failed to run. Please ensure the language server is running and try again.');
    }
}

export async function runFindReferences(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown
): Promise<FindReferencesResult | ApiErrorPayload>
{
    const raw = input as FindReferencesParams | null | undefined;
    const filePath = raw?.filePath;
    const position = raw?.position;
    const line = position?.line;
    const character = position?.character;

    if (typeof filePath !== 'string' || typeof line !== 'number' || typeof character !== 'number')
    {
        return makeError('InvalidParams', 'Invalid params. Provide filePath and position { line, character }.');
    }
    const trimmedPath = filePath.trim();
    if (trimmedPath.startsWith('file://'))
    {
        return makeError('InvalidParams', "Invalid params. 'filePath' must be an absolute path without the file:// scheme.");
    }
    if (!path.isAbsolute(trimmedPath))
    {
        return makeError('InvalidParams', "Invalid params. 'filePath' must be an absolute path.");
    }
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0)
    {
        return makeError('InvalidParams', "Invalid params. 'line' and 'character' must be non-negative integers.");
    }

    try
    {
        await startedClient;
        const resolved = resolveFilePathInput(trimmedPath);
        if (!resolved)
        {
            return makeError('INTERNAL_ERROR', 'Failed to convert filePath to file URI.');
        }
        const result = await client.sendRequest(
            'textDocument/references',
            {
                textDocument: { uri: resolved.uri },
                position: { line, character },
                context: { includeDeclaration: true }
            }
        ) as LspLocation[] | null;

        if (!result)
        {
            return makeError('NotReady', 'References are not available yet. Please wait for script parsing to finish and try again.');
        }

        const references: FindReferencesLocation[] = [];
        for (const location of result)
        {
            if (!location.uri.startsWith('file://'))
            {
                return makeError('INTERNAL_ERROR', 'Language server returned a non-file path in references.');
            }
            const absolutePath = fileUriToAbsolutePath(location.uri);
            if (!absolutePath)
            {
                return makeError('INTERNAL_ERROR', 'Failed to resolve reference file path from language server result.');
            }
            references.push({
                filePath: absolutePath,
                range: location.range
            });
        }

        return {
            ok: true,
            references
        };
    }
    catch (error)
    {
        console.error("angelscript_findReferences tool failed:", { filePath, line, character, error });
        return makeError('INTERNAL_ERROR', 'The angelscript_findReferences tool failed to run. Please ensure the language server is running and try again.');
    }
}
