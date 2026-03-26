import { LanguageClient } from 'vscode-languageclient/node';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import * as path from 'path';
import {
    AngelscriptSearchToolParams,
    buildSearchPayload,
    toApiSearchToolFailure
} from './angelscriptApiSearch';
import {
    GetAPISearchResult,
    GetAPISearchToolData,
    ToolFailure,
    ToolResult,
    GetTypeMembersParams,
    GetTypeMembersRequest,
    GetTypeMembersLspResult,
    GetTypeMembersResult,
    GetTypeMembersToolData,
    GetTypeHierarchyParams,
    GetTypeHierarchyRequest,
    GetTypeHierarchyLspResult,
    GetTypeHierarchyResult,
    GetTypeHierarchyToolData,
    TypeHierarchyClassSource,
    FindReferencesParams,
    FindReferencesResult,
    FindReferencesItem,
    ResolveSymbolAtPositionToolParams,
    ResolveSymbolAtPositionToolData,
    ResolveSymbolAtPositionToolResult,
    ResolveSymbolAtPositionRequest,
    ResolveSymbolAtPositionResult
} from './apiRequests';
import {
    applyResultLimit,
    normalizeFindReferencesLimit,
    normalizeHierarchySourceFilePath,
    resolveAbsoluteToolFilePathInput,
    toOutputPath
} from './toolContractUtils';

export type SearchOutputPayload = GetAPISearchToolData & {
    text?: string;
};

type LspLocation = {
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
};

type LspRange = LspLocation['range'];

type ResolvedReferenceLocation = {
    filePath: string;
    lspRange: LspRange;
};

const MAX_REFERENCE_PREVIEW_LINES = 20;
const MAX_RESOLVE_PREVIEW_LINES = 20;
const SOURCE_UNAVAILABLE_TEXT = '<source unavailable>';

type ResolveSymbolInfo = Exclude<ResolveSymbolAtPositionResult, { ok: false }>['symbol'];

function formatAbsoluteOutputFilePath(filePath: string): string
{
    return toOutputPath(filePath);
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

function toLspPositionFromOneBased(line: number, character: number): { line: number; character: number }
{
    return {
        line: line - 1,
        character: character - 1
    };
}

function toOneBasedLine(value: number): number
{
    return value + 1;
}

function toOneBasedCharacter(value: number): number
{
    return value + 1;
}

function toOneBasedRangeFromLsp(range: LspRange): FindReferencesItem['range']
{
    return {
        start: {
            line: toOneBasedLine(range.start.line),
            character: toOneBasedCharacter(range.start.character)
        },
        end: {
            line: toOneBasedLine(range.end.line),
            character: toOneBasedCharacter(range.end.character)
        }
    };
}

function getPreviewEndLine(range: LspRange): number
{
    const startLine = range.start.line;
    let endLine = range.end.line;
    if (endLine < startLine)
        endLine = startLine;
    if (endLine > startLine && range.end.character === 0)
        endLine -= 1;
    if (endLine < startLine)
        endLine = startLine;
    return endLine;
}

function isUnrealReflectionMacroLine(lineText: string): boolean
{
    return /^\s*U(?:CLASS|PROPERTY|FUNCTION|ENUM)\b/.test(lineText);
}

type SourcePreviewSection = {
    startLine: number;
    endLine: number;
    preview: string;
};

async function getFileLinesCached(
    absolutePath: string,
    fileLinesCache?: Map<string, Promise<string[] | null>>
): Promise<string[] | null>
{
    const normalizedPath = path.normalize(absolutePath);
    if (!fileLinesCache)
    {
        try
        {
            const content = await fs.readFile(normalizedPath, 'utf8');
            return content.split(/\r?\n/);
        }
        catch
        {
            return null;
        }
    }

    const cached = fileLinesCache.get(normalizedPath);
    if (cached)
        return await cached;

    const reader = fs.readFile(normalizedPath, 'utf8')
        .then((content) => content.split(/\r?\n/))
        .catch(() => null);
    fileLinesCache.set(normalizedPath, reader);
    return await reader;
}

async function buildSourcePreviewSection(
    absolutePath: string,
    startLineOneBased: number,
    endLineOneBased: number,
    options?: {
        includeMacroBacktrack?: boolean;
        maxLines?: number;
        fileLinesCache?: Map<string, Promise<string[] | null>>;
    }
): Promise<SourcePreviewSection>
{
    const normalizedPath = path.normalize(absolutePath);
    let safeStartLine = Number.isInteger(startLineOneBased) && startLineOneBased > 0 ? startLineOneBased : 1;
    let safeEndLine = Number.isInteger(endLineOneBased) && endLineOneBased > 0 ? endLineOneBased : safeStartLine;
    if (safeEndLine < safeStartLine)
        safeEndLine = safeStartLine;

    const maxLines = typeof options?.maxLines === 'number' && options.maxLines > 0
        ? options.maxLines
        : MAX_REFERENCE_PREVIEW_LINES;
    const fileLines = await getFileLinesCached(normalizedPath, options?.fileLinesCache);

    if (!fileLines || safeStartLine > fileLines.length)
    {
        return {
            startLine: safeStartLine,
            endLine: safeEndLine,
            preview: SOURCE_UNAVAILABLE_TEXT
        };
    }

    let effectiveStartLine = safeStartLine;
    if (options?.includeMacroBacktrack === true && safeStartLine > 1)
    {
        const previousLine = fileLines[safeStartLine - 2] ?? '';
        if (isUnrealReflectionMacroLine(previousLine))
            effectiveStartLine = safeStartLine - 1;
    }
    if (safeEndLine > fileLines.length)
        safeEndLine = fileLines.length;
    if (safeEndLine < effectiveStartLine)
        safeEndLine = effectiveStartLine;

    const snippetStartIndex = effectiveStartLine - 1;
    const snippetEndIndex = safeEndLine - 1;
    const maxSnippetEndIndex = Math.min(snippetEndIndex, snippetStartIndex + maxLines - 1);
    const snippetLines: string[] = [];
    for (let lineIndex = snippetStartIndex; lineIndex <= maxSnippetEndIndex; lineIndex += 1)
    {
        snippetLines.push(fileLines[lineIndex] ?? '');
    }
    if (snippetEndIndex > maxSnippetEndIndex)
        snippetLines.push('... (truncated)');

    return {
        startLine: effectiveStartLine,
        endLine: safeEndLine,
        preview: snippetLines.join('\n')
    };
}

async function buildResolveSuccessData(
    symbol: ResolveSymbolInfo
): Promise<ResolveSymbolAtPositionToolData>
{
    const kind = typeof symbol.kind === 'string' ? symbol.kind : 'unknown';
    const name = typeof symbol.name === 'string' ? symbol.name : '';
    const signature = typeof symbol.signature === 'string' && symbol.signature.length > 0 ? symbol.signature : name;
    const resolvedSymbol: ResolveSymbolAtPositionToolData['symbol'] = {
        kind,
        name,
        signature
    };
    if (symbol.doc)
    {
        resolvedSymbol.doc = {
            format: symbol.doc.format,
            text: symbol.doc.text
        };
    }

    const definition = symbol.definition;
    if (definition && definition.uri.startsWith('file://'))
    {
        const absoluteDefinitionPath = fileUriToAbsolutePath(definition.uri);
        if (absoluteDefinitionPath)
        {
            const definitionPreview = await buildSourcePreviewSection(
                absoluteDefinitionPath,
                toOneBasedLine(definition.startLine),
                toOneBasedLine(definition.endLine),
                {
                    includeMacroBacktrack: true,
                    maxLines: MAX_RESOLVE_PREVIEW_LINES
                }
            );
            resolvedSymbol.definition = {
                filePath: formatAbsoluteOutputFilePath(absoluteDefinitionPath),
                startLine: definitionPreview.startLine,
                endLine: definitionPreview.endLine,
                preview: definitionPreview.preview,
                matchStartLine: toOneBasedLine(definition.startLine),
                matchEndLine: toOneBasedLine(definition.endLine)
            };
        }
    }

    return { symbol: resolvedSymbol };
}

async function buildFindReferencesItems(references: ResolvedReferenceLocation[]): Promise<FindReferencesItem[]>
{
    const fileLinesCache = new Map<string, Promise<string[] | null>>();
    const items: FindReferencesItem[] = [];
    for (const reference of references)
    {
        const previewEndLine = getPreviewEndLine(reference.lspRange);
        const previewSection = await buildSourcePreviewSection(
            reference.filePath,
            toOneBasedLine(reference.lspRange.start.line),
            toOneBasedLine(previewEndLine),
            {
                maxLines: MAX_REFERENCE_PREVIEW_LINES,
                fileLinesCache
            }
        );

        items.push({
            filePath: formatAbsoluteOutputFilePath(reference.filePath),
            startLine: previewSection.startLine,
            endLine: previewSection.endLine,
            range: toOneBasedRangeFromLsp(reference.lspRange),
            preview: previewSection.preview
        });
    }
    return items;
}

function makeError(code: string, message: string, details?: Record<string, unknown>): ToolFailure
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

function makeErrorFromLsp(
    error: {
        code: string;
        message: string;
        retryable?: boolean;
        hint?: string;
    },
    details?: Record<string, unknown>
): ToolFailure
{
    return {
        ok: false,
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            hint: error.hint,
            details
        }
    };
}

async function buildTypeHierarchyToolData(
    result: Extract<GetTypeHierarchyLspResult, { ok: true }>
): Promise<GetTypeHierarchyToolData>
{
    const sourceByClass: Record<string, TypeHierarchyClassSource> = {};
    const fileLinesCache = new Map<string, Promise<string[] | null>>();

    const sourceByClassEntries = Object.entries(result.sourceByClass ?? {});
    for (const [className, sourceInfo] of sourceByClassEntries)
    {
        if (!sourceInfo)
            continue;
        if (sourceInfo.source === 'cpp')
        {
            sourceByClass[className] = {
                source: 'cpp'
            };
            continue;
        }

        const rawFilePath = typeof sourceInfo.filePath === 'string' ? sourceInfo.filePath.trim() : '';
        if (!rawFilePath)
        {
            sourceByClass[className] = {
                source: 'as',
                startLine: sourceInfo.startLine,
                endLine: sourceInfo.endLine,
                preview: SOURCE_UNAVAILABLE_TEXT
            };
            continue;
        }

        const absolutePath = normalizeHierarchySourceFilePath(rawFilePath);
        if (!absolutePath)
        {
            sourceByClass[className] = {
                source: 'as',
                startLine: sourceInfo.startLine,
                endLine: sourceInfo.endLine,
                preview: SOURCE_UNAVAILABLE_TEXT
            };
            continue;
        }

        const preview = await buildSourcePreviewSection(
            absolutePath,
            sourceInfo.startLine,
            sourceInfo.endLine,
            {
                maxLines: MAX_REFERENCE_PREVIEW_LINES,
                fileLinesCache
            }
        );

        sourceByClass[className] = {
            source: 'as',
            filePath: formatAbsoluteOutputFilePath(absolutePath),
            startLine: preview.startLine,
            endLine: preview.endLine,
            preview: preview.preview
        };
    }

    return {
        root: result.root,
        supers: result.supers,
        derivedByParent: result.derivedByParent,
        sourceByClass,
        limits: result.limits,
        truncated: result.truncated
    };
}

export async function runSearchApi(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown,
    shouldCancel?: () => boolean
): Promise<GetAPISearchResult>
{
    const raw = input as Partial<AngelscriptSearchToolParams> | null | undefined;
    const query = typeof raw?.query === 'string' ? raw.query.trim() : '';
    const hasExplicitIncludeInheritedFromScope = raw !== null
        && raw !== undefined
        && Object.prototype.hasOwnProperty.call(raw, 'includeInheritedFromScope')
        && typeof raw.includeInheritedFromScope === 'boolean';
    if (!query)
    {
        return makeError('MISSING_QUERY', 'Missing query. Please provide query.');
    }

    try
    {
        await startedClient;
        return {
            ok: true,
            data: await buildSearchPayload(client, {
                query,
                limit: raw?.limit,
                source: raw?.source,
                scope: raw?.scope,
                ...(hasExplicitIncludeInheritedFromScope ? { includeInheritedFromScope: raw.includeInheritedFromScope } : {}),
                includeDocs: raw?.includeDocs,
                regex: raw?.regex
            })
        };
    }
    catch (error)
    {
        const apiError = toApiSearchToolFailure(error);
        if (apiError)
            return makeError(apiError.code, apiError.message, apiError.details);
        console.error("angelscript_searchApi tool failed:", error);
        return makeError('INTERNAL_ERROR', 'The Angelscript API tool failed to run. Please ensure the language server is running and try again.');
    }
}

export async function runResolveSymbolAtPosition(
    client: LanguageClient,
    startedClient: Promise<void>,
    input: unknown
): Promise<ResolveSymbolAtPositionToolResult>
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
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1)
    {
        return makeError('InvalidParams', "Invalid params. 'line' and 'character' must be positive integers (1-based).");
    }

    const includeDocumentation = raw?.includeDocumentation !== false;

    try
    {
        await startedClient;
        const resolved = resolveAbsoluteToolFilePathInput(filePath);
        if (resolved.ok === false)
        {
            return makeError('InvalidParams', resolved.message, resolved.details);
        }
        const lspPosition = toLspPositionFromOneBased(line, character);
        return await client.sendRequest(
            ResolveSymbolAtPositionRequest,
            {
                uri: resolved.uri,
                position: lspPosition,
                includeDocumentation
            }
        ).then((result) =>
        {
            const lspResult = result as ResolveSymbolAtPositionResult;
            if (!lspResult)
            {
                return makeError('INTERNAL_ERROR', 'The resolveSymbolAtPosition tool received an invalid response.');
            }
            if (lspResult.ok === false)
                return makeErrorFromLsp(lspResult.error);
            const definition = lspResult.symbol.definition;
            if (definition && !definition.uri.startsWith('file://'))
            {
                return makeError('INTERNAL_ERROR', 'Language server returned a non-file path for definition.');
            }
            if (definition && !fileUriToAbsolutePath(definition.uri))
            {
                return makeError('INTERNAL_ERROR', 'Failed to resolve definition file path from language server result.');
            }
            return buildResolveSuccessData(lspResult.symbol).then((data) =>
            {
                data.request = {
                    filePath: formatAbsoluteOutputFilePath(resolved.absolutePath),
                    position: {
                        line,
                        character
                    },
                    includeDocumentation
                };
                return {
                    ok: true,
                    data
                };
            });
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
): Promise<GetTypeMembersResult>
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
        const result = await client.sendRequest<GetTypeMembersLspResult>(
            GetTypeMembersRequest.method,
            {
                name,
                namespace,
                includeInherited,
                includeDocs,
                kinds
            }
        ) as GetTypeMembersLspResult;
        if (!result)
        {
            return makeError('INTERNAL_ERROR', 'The angelscript_getTypeMembers tool received an invalid response.');
        }
        if (result.ok === false)
            return makeError(result.error.code, result.error.message);

        const data: GetTypeMembersToolData = {
            type: result.type,
            members: result.members,
            request: {
                name,
                ...(namespace !== undefined ? { namespace } : {}),
                includeInherited,
                includeDocs,
                kinds: kinds === 'method' || kinds === 'property' ? kinds : 'both'
            }
        };
        return {
            ok: true,
            data
        };
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
): Promise<GetTypeHierarchyResult>
{
    const raw = input as GetTypeHierarchyParams | null | undefined;
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name)
    {
        return makeError('InvalidParams', "Invalid params. 'name' must be a non-empty string.");
    }

    const maxSuperDepth = typeof raw?.maxSuperDepth === 'number' ? raw.maxSuperDepth : undefined;
    const maxSubDepth = typeof raw?.maxSubDepth === 'number' ? raw.maxSubDepth : undefined;
    const maxSubBreadth = typeof raw?.maxSubBreadth === 'number' ? raw.maxSubBreadth : undefined;
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
    if (maxSubBreadth !== undefined)
    {
        if (!Number.isInteger(maxSubBreadth) || maxSubBreadth < 0)
        {
            return makeError('InvalidParams', "Invalid params. 'maxSubBreadth' must be a non-negative integer.");
        }
    }
    if ((maxSuperDepth ?? 3) === 0 && (maxSubDepth ?? 2) === 0)
    {
        return makeError('InvalidParams', "Invalid params. 'maxSuperDepth' and 'maxSubDepth' cannot both be 0.");
    }

    try
    {
        await startedClient;
        const result = await client.sendRequest<GetTypeHierarchyLspResult>(
            GetTypeHierarchyRequest.method,
            {
                name,
                maxSuperDepth,
                maxSubDepth,
                maxSubBreadth
            }
        ) as GetTypeHierarchyLspResult;
        if (!result)
        {
            return makeError('INTERNAL_ERROR', 'The angelscript_getClassHierarchy tool received an invalid response.');
        }
        if (result.ok === false)
            return makeError(result.error.code, result.error.message);

        return {
            ok: true,
            data: await buildTypeHierarchyToolData(result)
        };
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
): Promise<FindReferencesResult>
{
    const raw = input as FindReferencesParams | null | undefined;
    const filePath = raw?.filePath;
    const position = raw?.position;
    const line = position?.line;
    const character = position?.character;
    const normalizedLimit = normalizeFindReferencesLimit(raw?.limit);

    if (typeof filePath !== 'string' || typeof line !== 'number' || typeof character !== 'number')
    {
        return makeError('InvalidParams', 'Invalid params. Provide filePath and position { line, character }.');
    }
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1)
    {
        return makeError('InvalidParams', "Invalid params. 'line' and 'character' must be positive integers (1-based).");
    }
    if (normalizedLimit.ok === false)
    {
        return makeError('InvalidParams', normalizedLimit.message, normalizedLimit.details);
    }

    try
    {
        await startedClient;
        const resolved = resolveAbsoluteToolFilePathInput(filePath);
        if (resolved.ok === false)
        {
            return makeError('InvalidParams', resolved.message, resolved.details);
        }
        const lspPosition = toLspPositionFromOneBased(line, character);
        const result = await client.sendRequest(
            'textDocument/references',
            {
                textDocument: { uri: resolved.uri },
                position: lspPosition,
                context: { includeDeclaration: true }
            }
        ) as LspLocation[] | null;

        if (!result)
        {
            return makeError('NotReady', 'References are not available yet. Please wait for script parsing to finish and try again.');
        }

        const limitedReferences = applyResultLimit(result, normalizedLimit.value);
        const references: ResolvedReferenceLocation[] = [];
        for (const location of limitedReferences.items)
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
                lspRange: location.range
            });
        }

        const items = await buildFindReferencesItems(references);
        return {
            ok: true,
            data: {
                total: limitedReferences.total,
                returned: items.length,
                limit: limitedReferences.limit,
                truncated: limitedReferences.truncated,
                references: items,
                request: {
                    filePath: formatAbsoluteOutputFilePath(resolved.absolutePath),
                    position: {
                        line,
                        character
                    },
                    limit: limitedReferences.limit
                }
            }
        };
    }
    catch (error)
    {
        console.error("angelscript_findReferences tool failed:", { filePath, line, character, error });
        return makeError('INTERNAL_ERROR', 'The angelscript_findReferences tool failed to run. Please ensure the language server is running and try again.');
    }
}
