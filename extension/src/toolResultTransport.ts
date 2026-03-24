export type LmToolOutputMode = 'text+structured' | 'text-only';

export type LmToolResultPartSpec = {
    type: 'text';
    text: string;
} | {
    type: 'json';
    value: unknown;
};

export function buildLmToolResultPartSpecs(
    text: string,
    payload: unknown,
    mode: LmToolOutputMode
): LmToolResultPartSpec[]
{
    if (mode === 'text-only')
    {
        return [{
            type: 'text',
            text
        }];
    }

    return [
        {
            type: 'text',
            text
        },
        {
            type: 'json',
            value: payload
        }
    ];
}
