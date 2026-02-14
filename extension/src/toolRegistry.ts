import * as vscode from 'vscode';
import * as z from 'zod';
import type { ZodType } from 'zod/v4/classic/schemas';
import { LanguageClient } from 'vscode-languageclient/node';
import { AngelscriptSearchParams } from './angelscriptApiSearch';
import { GetTypeHierarchyParams, GetTypeMembersParams, ResolveSymbolAtPositionToolParams, FindReferencesParams } from './apiRequests';
import {
    runFindReferences,
    runGetTypeHierarchy,
    runGetTypeMembers,
    runResolveSymbolAtPosition,
    runSearchApi
} from './toolShared';
import { formatToolText } from './toolTextFormatter';

export type ToolContext = {
    client: LanguageClient;
    startedClient: Promise<void>;
    shouldCancel?: () => boolean;
};

type ToolDefinition<TInput> = {
    name: string;
    description: string;
    inputSchema: ZodType;
    prepareInvocation?: (input: TInput | null | undefined) => string;
    run: (context: ToolContext, input: TInput | null | undefined) => Promise<unknown>;
};

function toPayloadObject(result: unknown): Record<string, unknown>
{
    if (result !== null && typeof result === 'object' && !Array.isArray(result))
        return result as Record<string, unknown>;
    return {
        value: result
    };
}

function toPayloadText(toolName: string, payload: Record<string, unknown>): string
{
    try
    {
        return formatToolText(toolName, payload);
    }
    catch
    {
        return [
            `${toolName} - error`,
            'code=INTERNAL_ERROR',
            'message=Failed to format tool text payload.'
        ].join('\n');
    }
}

function isErrorPayload(payload: Record<string, unknown>): boolean
{
    return payload.ok === false;
}

function prepareSearchInvocation(input: AngelscriptSearchParams | null | undefined): string
{
    const labelQuery = typeof input?.labelQuery === "string" ? input.labelQuery.trim() : "";
    const searchIndex = Number(input?.searchIndex);
    const maxBatchResults = typeof input?.maxBatchResults === "number" ? input.maxBatchResults : undefined;
    const includeDocs = input?.includeDocs === true ? "true" : "false";
    const labelQueryUseRegex = input?.labelQueryUseRegex === true ? "true" : "false";
    const signatureRegex = typeof input?.signatureRegex === "string" ? input.signatureRegex.trim() : "";
    const source = typeof input?.source === "string" ? input.source : "both";
    const kinds = Array.isArray(input?.kinds) ? input?.kinds.filter((item) => typeof item === "string") : [];

    const details: string[] = [];
    details.push(`source=${source}`);
    if (Number.isFinite(searchIndex))
        details.push(`index=${searchIndex}`);
    if (typeof maxBatchResults === "number")
        details.push(`max=${maxBatchResults}`);
    details.push(`docs=${includeDocs}`);
    details.push(`labelRegex=${labelQueryUseRegex}`);
    if (signatureRegex)
        details.push(`signatureRegex=${signatureRegex}`);
    if (kinds && kinds.length > 0)
        details.push(`kinds=${kinds.join(",")}`);

    const queryLabel = labelQuery ? `"${labelQuery}"` : "<empty>";
    return `Search Angelscript API ${queryLabel} (${details.join(", ")})`;
}

function prepareTypeMembersInvocation(input: GetTypeMembersParams | null | undefined): string
{
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    const namespace = typeof input?.namespace === "string" ? input.namespace.trim() : "";
    const includeInherited = input?.includeInherited === true ? "true" : "false";
    const includeDocs = input?.includeDocs === true ? "true" : "false";
    const kinds = typeof input?.kinds === "string" ? input.kinds.trim() : "both";
    const details: string[] = [];
    if (namespace)
        details.push(`namespace=${namespace}`);
    details.push(`includeInherited=${includeInherited}`);
    details.push(`includeDocs=${includeDocs}`);
    details.push(`kinds=${kinds || "both"}`);
    const label = name ? `"${name}"` : "<empty>";
    return `Get Angelscript type members ${label} (${details.join(", ")})`;
}

function prepareTypeHierarchyInvocation(input: GetTypeHierarchyParams | null | undefined): string
{
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    const maxSuperDepth = typeof input?.maxSuperDepth === "number" ? input.maxSuperDepth : 3;
    const maxSubDepth = typeof input?.maxSubDepth === "number" ? input.maxSubDepth : 2;
    const maxSubBreadth = typeof input?.maxSubBreadth === "number" ? input.maxSubBreadth : 10;
    const details: string[] = [];
    details.push(`maxSuperDepth=${maxSuperDepth}`);
    details.push(`maxSubDepth=${maxSubDepth}`);
    details.push(`maxSubBreadth=${maxSubBreadth}`);
    const label = name ? `"${name}"` : "<empty>";
    return `Get Angelscript type hierarchy ${label} (${details.join(", ")})`;
}

function prepareFindReferencesInvocation(input: { filePath?: string; position?: { line?: number; character?: number } } | null | undefined): string
{
    const filePath = typeof input?.filePath === "string" ? input.filePath.trim() : "";
    const line = typeof input?.position?.line === "number" ? input.position.line : undefined;
    const character = typeof input?.position?.character === "number" ? input.position.character : undefined;
    const location = (typeof line === "number" && typeof character === "number") ? `${line}:${character}` : "<unknown>";
    const label = filePath ? `"${filePath}"` : "<unknown>";
    return `Find Angelscript references ${label} (${location})`;
}

const toolDefinitions: Array<ToolDefinition<any>> = [
    {
        name: 'angelscript_searchApi',
        description:
            'Use when you need to discover Angelscript API symbols or docs by keyword and filters before you know the exact symbol. Do not use when you already have a concrete file position and need symbol resolution. Requires labelQuery and searchIndex. Query supports fuzzy syntax: space for ordered tokens ("a b" => a...b), "|" for OR, and separator constraints with "." or "::" (exact when adjacent, still fuzzy when separated by space, e.g. "UObject .", "Math ::"). Optional filters: kinds (class|struct|enum|method|function|property|globalVariable, case-insensitive, multi-value), source (native|script|both, default both), includeDocs, maxBatchResults (default 200). Regex support: labelQueryUseRegex applies regex to labels after kind filtering (supports /pattern/flags; omit i for case-sensitive; non-literal defaults to ignore case), and signatureRegex filters parsed signatures with the same regex syntax. Returns paged matches with fields such as labelQuery, searchIndex, nextSearchIndex, remainingCount, total, returned, truncated, and items (signature, optional docs, optional type), plus optional text/request for no-result context.',
        inputSchema: z.object({
            labelQuery: z.string().describe('Search query text for Angelscript API symbols.'),
            searchIndex: z.number().int().describe('0-based start index for paged results.'),
            maxBatchResults: z.number().int().optional().describe('Maximum number of results to return in this batch. Default is 200.'),
            includeDocs: z.boolean().optional().describe('Include documentation text in the docs field. Default is false.'),
            labelQueryUseRegex: z.boolean().optional().describe('Treat labelQuery as a regular expression applied to labels after kind filtering. Supports /pattern/flags (omit i for case-sensitive). If not using /pattern/flags, default ignore case. Default is false.'),
            signatureRegex: z.string().optional().describe('Regular expression to filter parsed signatures. Supports /pattern/flags (omit i for case-sensitive). If not using /pattern/flags, default ignore case.'),
            source: z.enum(['native', 'script', 'both']).optional().describe('Filter results by source. Supported values: native, script, both. Default is both.'),
            kinds: z.array(z.string().min(1)).optional().describe('Filter results by kinds. Supported values: class, struct, enum, method, function, property, globalVariable. Case-insensitive; multiple values allowed.')
        }),
        prepareInvocation: prepareSearchInvocation,
        run: async (context, input: AngelscriptSearchParams | null | undefined) =>
        {
            return await runSearchApi(
                context.client,
                context.startedClient,
                input,
                context.shouldCancel
            );
        }
    },
    {
        name: 'angelscript_resolveSymbolAtPosition',
        description: 'Use when you have a file path and cursor position and need to identify the symbol, signature, documentation, or definition. Do not use when your primary goal is collecting all references across the project. Requires filePath and position (line, character, both 1-based); input filePath supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/..."). Optional includeDocumentation controls doc payload (default true). Returns symbol details (kind, name, signature, optional doc) and optional definition with filePath, startLine, endLine, preview; preview checks one line above definition start for Unreal reflection macros (UCLASS|UPROPERTY|UFUNCTION|UENUM) and uses that line when matched.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file containing the symbol. Supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/...").'),
            position: z.object({
                line: z.number().int().min(1).describe('1-based line number in tool contract.'),
                character: z.number().int().min(1).describe('1-based character offset in tool contract.'),
            }),
            includeDocumentation: z.boolean().optional().describe('Include documentation when available. Default is true.')
        }),
        run: async (context, input: ResolveSymbolAtPositionToolParams | null | undefined) =>
        {
            return await runResolveSymbolAtPosition(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_getTypeMembers',
        description: 'Use when you need the member list of a specific Angelscript type, including inherited members when requested. Do not use when you need parent/child hierarchy traversal between classes. Requires exact name (optional namespace for disambiguation). Optional switches: includeInherited (default false), includeDocs (default false), and kinds (both|method|property, default both). Returns type identity (name, namespace, qualifiedName) and member entries including method/property/accessor/mixin-related metadata, visibility-qualified signatures, declaration origin fields, inheritance flags, and optional description text when includeDocs=true.',
        inputSchema: z.object({
            name: z.string().describe('Type name to inspect.'),
            namespace: z.string().optional().describe('Optional namespace to disambiguate type name. Use empty string for root namespace.'),
            includeInherited: z.boolean().optional().describe('Include inherited members (default false).'),
            includeDocs: z.boolean().optional().describe('Include description text (default false).'),
            kinds: z.enum(['both', 'method', 'property']).optional().describe('Filter by member kind (default both).')
        }),
        prepareInvocation: prepareTypeMembersInvocation,
        run: async (context, input: GetTypeMembersParams | null | undefined) =>
        {
            return await runGetTypeMembers(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_getClassHierarchy',
        description: 'Use when you need class inheritance structure, including parent chain and derived-class expansion. Do not use when you only need members of a single type. Requires exact class name (e.g., "APawn"). Optional limits: maxSuperDepth (default 3), maxSubDepth (default 2), maxSubBreadth (default 10). Returns compact hierarchy data including root, supers (nearest parent first), derivedByParent (parent -> direct children), sourceByClass, limits, and truncated info (supers, derivedDepth, derivedBreadthByClass).',
        inputSchema: z.object({
            name: z.string().describe('Exact class name to inspect (e.g., "APawn").'),
            maxSuperDepth: z.number().int().optional().describe('Maximum number of supertypes to return. Non-negative integer. Default is 3.'),
            maxSubDepth: z.number().int().optional().describe('Maximum depth for subtype tree. Non-negative integer. Default is 2.'),
            maxSubBreadth: z.number().int().optional().describe('Maximum number of direct children returned per class. Non-negative integer. Default is 10. Truncation count is reported in truncated.derivedBreadthByClass.')
        }),
        prepareInvocation: prepareTypeHierarchyInvocation,
        run: async (context, input: GetTypeHierarchyParams | null | undefined) =>
        {
            return await runGetTypeHierarchy(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_findReferences',
        description: 'Use when you have a symbol location and need all project references to that symbol. Do not use when you only need to identify what symbol is at the current position. Requires filePath and position (line, character, both 1-based); input filePath supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/..."). Returns total and references[]; each reference includes filePath, startLine, endLine, range, and preview (range is 1-based).',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file containing the symbol. Supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/...").'),
            position: z.object({
                line: z.number().int().min(1).describe('1-based line number in tool contract.'),
                character: z.number().int().min(1).describe('1-based character offset in tool contract.')
            })
        }),
        prepareInvocation: prepareFindReferencesInvocation,
        run: async (context, input: FindReferencesParams | null | undefined) =>
        {
            return await runFindReferences(context.client, context.startedClient, input);
        }
    }
];

class SharedLmTool<TInput> implements vscode.LanguageModelTool<TInput>
{
    client: LanguageClient;
    startedClient: Promise<void>;
    definition: ToolDefinition<TInput>;

    constructor(definition: ToolDefinition<TInput>, client: LanguageClient, startedClient: Promise<void>)
    {
        this.definition = definition;
        this.client = client;
        this.startedClient = startedClient;
    }

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>
    ): vscode.ProviderResult<vscode.PreparedToolInvocation>
    {
        if (!this.definition.prepareInvocation)
            return undefined;
        return {
            invocationMessage: this.definition.prepareInvocation(options?.input ?? undefined)
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<TInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult>
    {
        const result = await this.definition.run(
            {
                client: this.client,
                startedClient: this.startedClient,
                shouldCancel: () => token.isCancellationRequested
            },
            options?.input ?? undefined
        );
        const payload = toPayloadObject(result);
        const outputText = toPayloadText(this.definition.name, payload);
        try
        {
            return new vscode.LanguageModelToolResult([
                vscode.LanguageModelDataPart.json(payload),
                new vscode.LanguageModelTextPart(outputText)
            ]);
        }
        catch (error)
        {
            const fallbackPayload: Record<string, unknown> = {
                ok: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to create LanguageModelDataPart json payload.',
                    details: {
                        reason: error instanceof Error ? error.message : String(error)
                    }
                }
            };
            return new vscode.LanguageModelToolResult([
                vscode.LanguageModelDataPart.json(fallbackPayload),
                new vscode.LanguageModelTextPart(toPayloadText(this.definition.name, fallbackPayload))
            ]);
        }
    }
}

export function registerLmTools(
    context: vscode.ExtensionContext,
    client: LanguageClient,
    startedClient: Promise<void>
): void
{
    const lm = (vscode as any).lm;
    if (!lm?.registerTool)
        return;

    for (const definition of toolDefinitions)
    {
        const tool = new SharedLmTool(definition, client, startedClient);
        const disposable = vscode.lm.registerTool(definition.name, tool);
        context.subscriptions.push(disposable);
    }
}
