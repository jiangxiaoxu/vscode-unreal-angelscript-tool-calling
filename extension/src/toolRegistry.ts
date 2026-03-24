import * as vscode from 'vscode';
import * as z from 'zod';
import type { ZodType } from 'zod/v4/classic/schemas';
import { LanguageClient } from 'vscode-languageclient/node';
import { AngelscriptSearchParams } from './angelscriptApiSearch';
import {
    FindReferencesParams,
    GetTypeHierarchyParams,
    GetTypeMembersParams,
    ResolveSymbolAtPositionToolParams,
    SearchKind
} from './apiRequests';
import {
    runFindReferences,
    runGetTypeHierarchy,
    runGetTypeMembers,
    runResolveSymbolAtPosition,
    runSearchApi
} from './toolShared';
import { DEFAULT_FIND_REFERENCES_LIMIT } from './toolContractUtils';
import { formatToolText } from './toolTextFormatter';
import { buildLmToolResultPartSpecs, LmToolOutputMode } from './toolResultTransport';

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

const searchKindOptions = [
    'class',
    'struct',
    'enum',
    'method',
    'function',
    'property',
    'globalVariable'
] as const satisfies readonly SearchKind[];

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
            'Angelscript tool',
            'error: Failed to format tool text payload.',
            'code: INTERNAL_ERROR'
        ].join('\n');
    }
}

function prepareSearchInvocation(input: AngelscriptSearchParams | null | undefined): string
{
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    const mode = typeof input?.mode === "string" ? input.mode : "smart";
    const limit = typeof input?.limit === "number" ? input.limit : undefined;
    const source = typeof input?.source === "string" ? input.source : "both";
    const kinds = Array.isArray(input?.kinds) ? input?.kinds.filter((item) => typeof item === "string") : [];
    const scopePrefix = typeof input?.scopePrefix === "string" ? input.scopePrefix.trim() : "";
    const includeInheritedFromScope = input?.includeInheritedFromScope === true ? "true" : "false";

    const details: string[] = [];
    details.push(`mode=${mode}`);
    details.push(`source=${source}`);
    if (typeof limit === "number")
        details.push(`limit=${limit}`);
    if (kinds && kinds.length > 0)
        details.push(`kinds=${kinds.join(",")}`);
    if (scopePrefix)
        details.push(`scope=${scopePrefix}`);
    details.push(`inheritScope=${includeInheritedFromScope}`);

    const queryLabel = query ? `"${query}"` : "<empty>";
    return `Search Angelscript API ${queryLabel} (${details.join(", ")})`;
}

function normalizeLmToolOutputMode(value: unknown): LmToolOutputMode
{
    return value === 'text-only' ? 'text-only' : 'text+structured';
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

function prepareFindReferencesInvocation(input: FindReferencesParams | null | undefined): string
{
    const filePath = typeof input?.filePath === "string" ? input.filePath.trim() : "";
    const line = typeof input?.position?.line === "number" ? input.position.line : undefined;
    const character = typeof input?.position?.character === "number" ? input.position.character : undefined;
    const limit = typeof input?.limit === "number" ? input.limit : DEFAULT_FIND_REFERENCES_LIMIT;
    const location = (typeof line === "number" && typeof character === "number") ? `${line}:${character}` : "<unknown>";
    const label = filePath ? `"${filePath}"` : "<unknown>";
    return `Find Angelscript references ${label} (${location}, limit=${limit})`;
}

const toolDefinitions: Array<ToolDefinition<any>> = [
    {
        name: 'angelscript_searchApi',
        description:
            'Use when you need to discover Angelscript API symbols before you know the exact symbol name. Do not use when you already have a concrete file position and need symbol resolution. Requires query. Optional controls: mode (smart|exact|regex, default smart), limit (default 20, max 200), kinds (class|struct|enum|method|function|property|globalVariable), source (native|script|both, default both), scopePrefix, includeInheritedFromScope. Function results include namespace/global functions and mixin functions. Regex mode matches short names, canonical qualified names, and mixin member-view aliases only. When includeInheritedFromScope is requested, the top-level result may include inheritedScopeOutcome. Returns readable text and, by default, structured JSON payload.',
        inputSchema: z.object({
            query: z.string().describe('Search query for Angelscript API symbols.'),
            mode: z.enum(['smart', 'exact', 'regex']).optional().describe('Search mode. Default is smart.'),
            limit: z.number().int().min(1).max(200).optional().describe('Maximum number of matches to return. Default is 20.'),
            source: z.enum(['native', 'script', 'both']).optional().describe('Filter results by source. Supported values: native, script, both. Default is both.'),
            kinds: z.array(z.enum(searchKindOptions)).optional().describe('Filter results by kinds.'),
            scopePrefix: z.string().optional().describe('Optional namespace or type scope. Namespace scopes filter declared descendants. Type scopes filter declared members, can expand inherited methods and properties, and also surface applicable mixin functions.'),
            includeInheritedFromScope: z.boolean().optional().describe('Only applies to class/type scopes. When true, expands inherited methods and properties. Default is false.')
        }).strict(),
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
        description: 'Use when you have an absolute file path and cursor position and need to identify the symbol, signature, documentation, or definition. Do not use when your primary goal is collecting all references across the project. Requires absolute filePath and position (line, character, both 1-based). Optional includeDocumentation controls doc payload (default true). Returns readable text and, by default, structured JSON payload. When definition exists, output includes absolute filePath, line range, preview text, and checks one line above definition start for Unreal macros UCLASS/UPROPERTY/UFUNCTION/UENUM.',
        inputSchema: z.object({
            filePath: z.string().describe('Absolute path to the file containing the symbol.'),
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
        description: 'Use when you need the member list of a specific Angelscript type, including inherited members when requested. Do not use when you need parent/child hierarchy traversal between classes. Requires exact name (optional namespace for disambiguation). Optional switches: includeInherited (default false), includeDocs (default false), and kinds (both|method|property, default both). Returns readable text and, by default, structured JSON payload with type identity and member entries.',
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
        description: 'Use when you need class inheritance structure, including parent chain and derived-class expansion. Do not use when you only need members of a single type. Requires exact class name (e.g., "APawn"). Optional limits: maxSuperDepth (default 3), maxSubDepth (default 2), maxSubBreadth (default 10). Returns readable text and, by default, structured JSON payload, including root, supers, derivedByParent, limits, truncated info, and script-class preview text when available. If a script source path cannot be resolved, that preview degrades to source unavailable instead of failing the tool.',
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
        description: 'Use when you have a symbol location and need project references to that symbol. Do not use when you only need to identify what symbol is at the current position. Requires absolute filePath and position (line, character, both 1-based). Optional limit controls the maximum number of returned references (default 30, max 200). Returns readable text and, by default, structured JSON payload with total, returned, limit, truncated, per-file grouping, 1-based range labels, and preview text.',
        inputSchema: z.object({
            filePath: z.string().describe('Absolute path to the file containing the symbol.'),
            position: z.object({
                line: z.number().int().min(1).describe('1-based line number in tool contract.'),
                character: z.number().int().min(1).describe('1-based character offset in tool contract.')
            }),
            limit: z.number().int().min(1).max(200).optional().describe('Maximum number of references to return. Default is 30.')
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
            const outputMode = normalizeLmToolOutputMode(
                vscode.workspace.getConfiguration('UnrealAngelscript').get('languageModelTools.outputMode')
            );
            const partSpecs = buildLmToolResultPartSpecs(outputText, payload, outputMode);
            const parts = partSpecs.map((part) =>
            {
                if (part.type === 'json')
                    return vscode.LanguageModelDataPart.json(part.value);
                return new vscode.LanguageModelTextPart(part.text);
            });
            return new vscode.LanguageModelToolResult(
                parts
            );
        }
        catch (error)
        {
            const fallbackText = [
                'Angelscript tool',
                `error: Failed to build LM text result. ${error instanceof Error ? error.message : String(error)}`,
                'code: INTERNAL_ERROR'
            ].join('\n');
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(fallbackText)
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
