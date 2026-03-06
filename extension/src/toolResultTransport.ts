export type LmTextResultPartSpec = {
    type: 'text';
    text: string;
};

export type McpTextToolResponse = {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: true;
};

export function buildLmTextResultPartSpecs(text: string): LmTextResultPartSpec[]
{
    return [{
        type: 'text',
        text
    }];
}

export function buildMcpTextToolResponse(text: string, isError: boolean): McpTextToolResponse
{
    return {
        content: [{
            type: 'text',
            text
        }],
        ...(isError ? { isError: true as const } : {})
    };
}
