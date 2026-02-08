import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
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
    FindReferencesLocation,
    ResolveSymbolAtPositionToolParams,
    ResolveSymbolAtPositionToolData,
    ResolveSymbolAtPositionToolResult,
    ResolveSymbolAtPositionRequest,
    ResolveSymbolAtPositionResult
} from './apiRequests';

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

const MAX_REFERENCE_PREVIEW_LINES = 20;
const MAX_RESOLVE_PREVIEW_LINES = 20;
const SOURCE_UNAVAILABLE_TEXT = '<source unavailable>';

type WorkspacePathResolutionSuccess = {
    ok: true;
    absolutePath: string;
};

type ResolveSymbolInfo = Exclude<ResolveSymbolAtPositionResult, { ok: false }>['symbol'];

type WorkspacePathResolutionFailure = {
    ok: false;
    message: string;
    details?: Record<string, unknown>;
};

type WorkspacePathResolution = WorkspacePathResolutionSuccess | WorkspacePathResolutionFailure;

type ToolPathResolutionSuccess = {
    ok: true;
    absolutePath: string;
    uri: string;
};

type ToolPathResolutionFailure = {
    ok: false;
    message: string;
    details?: Record<string, unknown>;
};

type ToolPathResolution = ToolPathResolutionSuccess | ToolPathResolutionFailure;

function isWorkspacePathResolutionFailure(value: WorkspacePathResolution): value is WorkspacePathResolutionFailure
{
    return value.ok === false;
}

function isToolPathResolutionFailure(value: ToolPathResolution): value is ToolPathResolutionFailure
{
    return value.ok === false;
}

function toOutputPath(filePath: string): string
{
    return path.normalize(filePath).replace(/\\/g, '/');
}

function samePath(a: string, b: string): boolean
{
    if (process.platform === 'win32')
        return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean
{
    const normalizedFilePath = path.normalize(filePath);
    const normalizedRootPath = path.normalize(rootPath);
    if (samePath(normalizedFilePath, normalizedRootPath))
        return true;

    const relativePath = path.relative(normalizedRootPath, normalizedFilePath);
    if (!relativePath)
        return true;
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[]
{
    return vscode.workspace.workspaceFolders ?? [];
}

function formatOutputFilePath(filePath: string): string
{
    const normalizedPath = path.normalize(filePath);
    if (!path.isAbsolute(normalizedPath))
        return toOutputPath(normalizedPath);

    const workspaceFolders = getWorkspaceFolders();
    let bestFolder: vscode.WorkspaceFolder | null = null;
    let bestRootPath = '';

    for (const workspaceFolder of workspaceFolders)
    {
        const rootPath = path.normalize(workspaceFolder.uri.fsPath);
        if (!isPathInsideRoot(normalizedPath, rootPath))
            continue;
        if (!bestFolder || rootPath.length > bestRootPath.length)
        {
            bestFolder = workspaceFolder;
            bestRootPath = rootPath;
        }
    }

    if (!bestFolder)
        return toOutputPath(normalizedPath);

    const relativePath = path.relative(bestRootPath, normalizedPath);
    if (!relativePath)
        return bestFolder.name;

    return `${bestFolder.name}/${toOutputPath(relativePath)}`;
}

function splitWorkspacePathSegments(inputPath: string): string[]
{
    return inputPath
        .trim()
        .split(/[\\/]+/)
        .filter((segment) => segment.length > 0 && segment !== '.');
}

function containsParentTraversal(segments: string[]): boolean
{
    return segments.some((segment) => segment === '..');
}

function matchWorkspaceFolderByName(name: string): vscode.WorkspaceFolder[]
{
    const workspaceFolders = getWorkspaceFolders();
    if (process.platform === 'win32')
    {
        const lowered = name.toLowerCase();
        return workspaceFolders.filter((folder) => folder.name.toLowerCase() === lowered);
    }
    return workspaceFolders.filter((folder) => folder.name === name);
}

async function pickExistingCandidates(candidates: string[]): Promise<string[]>
{
    const existingCandidates = await Promise.all(candidates.map(async (candidate) =>
    {
        try
        {
            await fs.stat(candidate);
            return candidate;
        }
        catch
        {
            return null;
        }
    }));
    return existingCandidates.filter((candidate): candidate is string => typeof candidate === 'string');
}

function toWorkspaceCandidateLabels(candidates: string[]): string[]
{
    return candidates.map((candidate) => formatOutputFilePath(candidate));
}

async function resolveWorkspaceRelativePathToAbsolute(filePath: string): Promise<WorkspacePathResolution>
{
    const segments = splitWorkspacePathSegments(filePath);
    if (segments.length === 0)
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' must be a non-empty path string."
        };
    }
    if (containsParentTraversal(segments))
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' must not include '..' segments."
        };
    }

    const workspaceFolders = getWorkspaceFolders();
    if (workspaceFolders.length === 0)
    {
        return {
            ok: false,
            message: "Invalid params. Relative 'filePath' requires an open workspace folder.",
            details: {
                filePath
            }
        };
    }

    const matchedFolders = matchWorkspaceFolderByName(segments[0]);
    if (matchedFolders.length > 0)
    {
        if (segments.length === 1)
        {
            return {
                ok: false,
                message: "Invalid params. Workspace-relative 'filePath' must include a path after the workspace folder name.",
                details: {
                    filePath,
                    workspaceFolderName: segments[0]
                }
            };
        }

        const relativePath = path.join(...segments.slice(1));
        const prefixedCandidates = matchedFolders.map((folder) => path.normalize(path.join(folder.uri.fsPath, relativePath)));
        if (prefixedCandidates.length === 1)
        {
            return {
                ok: true,
                absolutePath: prefixedCandidates[0]
            };
        }

        const existingCandidates = await pickExistingCandidates(prefixedCandidates);
        if (existingCandidates.length === 1)
        {
            return {
                ok: true,
                absolutePath: existingCandidates[0]
            };
        }

        return {
            ok: false,
            message: "Invalid params. Workspace folder name is ambiguous in this multi-root workspace.",
            details: {
                filePath,
                workspaceFolderName: segments[0],
                candidates: toWorkspaceCandidateLabels(prefixedCandidates)
            }
        };
    }

    const relativePath = path.join(...segments);
    if (workspaceFolders.length === 1)
    {
        return {
            ok: true,
            absolutePath: path.normalize(path.join(workspaceFolders[0].uri.fsPath, relativePath))
        };
    }

    const candidates = workspaceFolders.map((folder) => path.normalize(path.join(folder.uri.fsPath, relativePath)));
    const existingCandidates = await pickExistingCandidates(candidates);
    if (existingCandidates.length === 1)
    {
        return {
            ok: true,
            absolutePath: existingCandidates[0]
        };
    }

    const rootHint = workspaceFolders[0].name;
    const hintPath = `${rootHint}/${segments.join('/')}`;
    const hasManyMatches = existingCandidates.length > 1;
    return {
        ok: false,
        message: hasManyMatches
            ? "Invalid params. Relative 'filePath' is ambiguous across workspace folders. Please prefix it with the workspace folder name."
            : "Invalid params. Relative 'filePath' cannot be resolved uniquely in a multi-root workspace. Please prefix it with the workspace folder name.",
        details: {
            filePath,
            workspaceFolders: workspaceFolders.map((folder) => folder.name),
            candidates: toWorkspaceCandidateLabels(hasManyMatches ? existingCandidates : candidates),
            hint: hintPath
        }
    };
}

async function resolveToolFilePathInput(filePath: string): Promise<ToolPathResolution>
{
    const trimmedPath = filePath.trim();
    if (!trimmedPath)
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' must be a non-empty string."
        };
    }
    if (trimmedPath.startsWith('file://'))
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' must not include the file:// scheme."
        };
    }

    let absolutePath = '';
    if (path.isAbsolute(trimmedPath))
    {
        absolutePath = path.normalize(trimmedPath);
    }
    else
    {
        const workspaceResolution = await resolveWorkspaceRelativePathToAbsolute(trimmedPath);
        if (isWorkspacePathResolutionFailure(workspaceResolution))
        {
            return {
                ok: false,
                message: workspaceResolution.message,
                details: workspaceResolution.details
            };
        }
        absolutePath = workspaceResolution.absolutePath;
    }

    try
    {
        return {
            ok: true,
            absolutePath,
            uri: pathToFileURL(absolutePath).toString()
        };
    }
    catch
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' is not a valid file system path.",
            details: {
                filePath
            }
        };
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

function getPreviewEndLine(range: FindReferencesLocation['range']): number
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
                filePath: formatOutputFilePath(absoluteDefinitionPath),
                startLine: definitionPreview.startLine,
                endLine: definitionPreview.endLine,
                preview: definitionPreview.preview
            };
        }
    }

    return { symbol: resolvedSymbol };
}

async function buildFindReferencesItems(references: FindReferencesLocation[]): Promise<FindReferencesItem[]>
{
    const fileLinesCache = new Map<string, Promise<string[] | null>>();
    const items: FindReferencesItem[] = [];
    for (const reference of references)
    {
        const previewEndLine = getPreviewEndLine(reference.range);
        const previewSection = await buildSourcePreviewSection(
            reference.filePath,
            toOneBasedLine(reference.range.start.line),
            toOneBasedLine(previewEndLine),
            {
                maxLines: MAX_REFERENCE_PREVIEW_LINES,
                fileLinesCache
            }
        );

        items.push({
            filePath: formatOutputFilePath(reference.filePath),
            startLine: previewSection.startLine,
            endLine: previewSection.endLine,
            range: reference.range,
            preview: previewSection.preview
        });
    }
    return items;
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

function makeErrorFromApiPayload(payload: ApiErrorPayload): ToolFailure
{
    return {
        ok: false,
        error: {
            code: payload.error.code,
            message: payload.error.message,
            details: payload.error.details
        }
    };
}

async function buildTypeHierarchyToolData(
    result: Extract<GetTypeHierarchyLspResult, { ok: true }>
): Promise<GetTypeHierarchyToolData | ToolFailure>
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
                filePath: '',
                startLine: sourceInfo.startLine,
                endLine: sourceInfo.endLine,
                preview: SOURCE_UNAVAILABLE_TEXT
            };
            continue;
        }

        let absolutePath = '';

        if (path.isAbsolute(rawFilePath))
        {
            absolutePath = path.normalize(rawFilePath);
        }
        else
        {
            const resolvedPath = await resolveWorkspaceRelativePathToAbsolute(rawFilePath);
            if (isWorkspacePathResolutionFailure(resolvedPath))
            {
                return makeError(
                    'InvalidParams',
                    `Invalid class hierarchy source path for "${className}". ${resolvedPath.message}`,
                    {
                        className,
                        filePath: rawFilePath,
                        ...(resolvedPath.details ?? {})
                    }
                );
            }
            absolutePath = resolvedPath.absolutePath;
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
            filePath: formatOutputFilePath(absolutePath),
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
): Promise<ToolResult<SearchOutputPayload>>
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
        return {
            ok: true,
            data: formatSearchPayloadForOutput(payload, raw)
        };
    }
    catch (error)
    {
        const apiError = toApiErrorPayload(error);
        if (apiError)
            return makeErrorFromApiPayload(apiError);
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
        const resolved = await resolveToolFilePathInput(filePath);
        if (isToolPathResolutionFailure(resolved))
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
            members: result.members
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

        const data = await buildTypeHierarchyToolData(result);
        if ((data as ToolFailure).ok === false)
            return data as ToolFailure;

        return {
            ok: true,
            data: data as GetTypeHierarchyToolData
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

    if (typeof filePath !== 'string' || typeof line !== 'number' || typeof character !== 'number')
    {
        return makeError('InvalidParams', 'Invalid params. Provide filePath and position { line, character }.');
    }
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(character) || character < 1)
    {
        return makeError('InvalidParams', "Invalid params. 'line' and 'character' must be positive integers (1-based).");
    }

    try
    {
        await startedClient;
        const resolved = await resolveToolFilePathInput(filePath);
        if (isToolPathResolutionFailure(resolved))
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

        const items = await buildFindReferencesItems(references);
        return {
            ok: true,
            data: {
                total: items.length,
                references: items
            }
        };
    }
    catch (error)
    {
        console.error("angelscript_findReferences tool failed:", { filePath, line, character, error });
        return makeError('INTERNAL_ERROR', 'The angelscript_findReferences tool failed to run. Please ensure the language server is running and try again.');
    }
}
