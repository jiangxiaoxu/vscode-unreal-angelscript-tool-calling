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
            'Search Angelscript API symbols and docs. Spaces act as ordered wildcards; use "a b" to match a...b. Use "|" to separate alternate queries (OR). Use "." or "::" to require those separators; without a space they must be adjacent (e.g., "UObject." or "Math::"), with a space they stay fuzzy (e.g., "UObject ." or "Math ::"). Optional kinds filter: class, struct, enum, method, function, property, globalVariable (case-insensitive, multiple allowed). Optional source filter: native, script, both (default). Signature is always returned; includeDocs controls documentation payload. Paging uses searchIndex (required) and maxBatchResults (default 200). Set labelQueryUseRegex to true to apply a regex to labelQuery after kind filtering; supports /pattern/flags (omit i for case-sensitive). If not using /pattern/flags, default ignore case. Set signatureRegex to filter parsed signatures using a regex (supports /pattern/flags). Returns JSON envelope: success { ok:true, data:{...} }, failure { ok:false, error:{ code, message, details? } }.',
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
        description: 'Resolve a symbol at a given document position. Input line/character are 1-based. Input filePath supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/..."). Returns JSON envelope: success { ok:true, data:{ symbol:{ kind, name, signature, definition?, doc? } } }, failure { ok:false, error:{ code, message, retryable?, hint?, details? } }. When definition exists, definition contains { filePath, startLine, endLine, preview }; preview is source text for that line range and checks one line above start for Unreal macros UCLASS/UPROPERTY/UFUNCTION/UENUM.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file containing the symbol. Supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/...").'),
            position: z.object({
                line: z.number().int().min(1).describe('1-based line number.'),
                character: z.number().int().min(1).describe('1-based character offset.'),
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
        description: 'List all members (methods, properties, accessors, mixins) for a type, including inherited members when requested. Returns JSON envelope: success { ok:true, data:{ type, members } }, failure { ok:false, error:{ code, message, details? } }.',
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
        description: 'Get class hierarchy in compact JSON for an exact class name (e.g., "APawn"). Returns JSON envelope: success { ok:true, data:{ root, supers, derivedByParent, sourceByClass, limits, truncated } }, failure { ok:false, error:{ code, message, details? } }. sourceByClass[className] is { source:"cpp" } or { source:"as", filePath, startLine, endLine, preview }, where filePath prefers workspace-relative path with root prefix and falls back to absolute path when outside workspace; line numbers are 1-based. preview is source text for the class range (max 20 lines). Supports depth and breadth limits.',
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
        description: 'Find references for the symbol at a given document position. Input line/character are 1-based. Input filePath supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/..."). Returns JSON envelope: success { ok:true, data:{ total, references[] } }, failure { ok:false, error:{ code, message, retryable?, hint?, details? } }. Each references[] item includes { filePath, startLine, endLine, range, preview }, where preview is source text for that location range (max 20 lines). range keeps raw LSP offsets (0-based).',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file containing the symbol. Supports absolute path or workspace-relative path (prefer "<workspaceFolderName>/...").'),
            position: z.object({
                line: z.number().int().min(1).describe('1-based line number.'),
                character: z.number().int().min(1).describe('1-based character offset.')
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
        const outputText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(outputText)
        ]);
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

export function registerMcpTools(
    server: { registerTool: (...args: any[]) => void },
    client: LanguageClient,
    startedClient: Promise<void>
): void
{
    for (const definition of toolDefinitions)
    {
        server.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema
            },
            async (args: unknown, extra: { signal?: AbortSignal }) =>
            {
                const result = await definition.run(
                    {
                        client,
                        startedClient,
                        shouldCancel: () => extra?.signal?.aborted ?? false
                    },
                    args as never
                );
                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                        }
                    ]
                };
            }
        );
    }
}
