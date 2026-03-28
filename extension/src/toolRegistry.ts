import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { AngelscriptSearchToolParams } from './angelscriptApiSearch';
import {
    FindReferencesParams,
    GetTypeHierarchyParams,
    GetTypeMembersParams,
    ResolveSymbolAtPositionToolParams
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
            'Angelscript tool',
            'error: Failed to format tool text payload.',
            'code: INTERNAL_ERROR'
        ].join('\n');
    }
}

function prepareSearchInvocation(input: AngelscriptSearchToolParams | null | undefined): string
{
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    const mode = input?.mode === "regex" ? "regex" : "smart";
    const limit = typeof input?.limit === "number" ? input.limit : undefined;
    const source = typeof input?.source === "string" ? input.source : "both";
    const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
    const includeInheritedFromScope = typeof input?.includeInheritedFromScope === "boolean"
        ? (input.includeInheritedFromScope ? "true" : "false")
        : "auto";
    const includeDocs = input?.includeDocs === true ? "true" : "false";
    const symbolLevel = input?.symbolLevel === "type" ? "type" : "all";
    const kinds = Array.isArray(input?.kinds) && input.kinds.length > 0
        ? input.kinds.join("|")
        : "";

    const details: string[] = [];
    details.push(`mode=${mode}`);
    details.push(`source=${source}`);
    if (typeof limit === "number")
        details.push(`limit=${limit}`);
    if (scope)
        details.push(`scope=${scope}`);
    if (kinds)
        details.push(`kinds=${kinds}`);
    details.push(`inheritScope=${includeInheritedFromScope}`);
    details.push(`includeDocs=${includeDocs}`);
    details.push(`symbolLevel=${symbolLevel}`);

    const queryLabel = query ? `"${query}"` : "<empty>";
    return `Search Angelscript API ${queryLabel} (${details.join(", ")})`;
}

function normalizeLmToolOutputMode(value: unknown): LmToolOutputMode
{
    return value === 'text+structured' ? 'text+structured' : 'text-only';
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
        prepareInvocation: prepareSearchInvocation,
        run: async (context, input: AngelscriptSearchToolParams | null | undefined) =>
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
        run: async (context, input: ResolveSymbolAtPositionToolParams | null | undefined) =>
        {
            return await runResolveSymbolAtPosition(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_getTypeMembers',
        prepareInvocation: prepareTypeMembersInvocation,
        run: async (context, input: GetTypeMembersParams | null | undefined) =>
        {
            return await runGetTypeMembers(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_getClassHierarchy',
        prepareInvocation: prepareTypeHierarchyInvocation,
        run: async (context, input: GetTypeHierarchyParams | null | undefined) =>
        {
            return await runGetTypeHierarchy(context.client, context.startedClient, input);
        }
    },
    {
        name: 'angelscript_findReferences',
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
