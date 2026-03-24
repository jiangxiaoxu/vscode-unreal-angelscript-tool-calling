import * as path from 'path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_FIND_REFERENCES_LIMIT = 30;
export const MAX_FIND_REFERENCES_LIMIT = 200;

export type ToolPathResolution = {
    ok: true;
    absolutePath: string;
    uri: string;
} | {
    ok: false;
    message: string;
    details?: Record<string, unknown>;
};

export type FindReferencesLimitResolution = {
    ok: true;
    value: number;
} | {
    ok: false;
    message: string;
    details?: Record<string, unknown>;
};

export type LimitedResult<T> = {
    items: T[];
    total: number;
    returned: number;
    limit: number;
    truncated: boolean;
};

export function toOutputPath(filePath: string): string
{
    return path.normalize(filePath).replace(/\\/g, '/');
}

export function resolveAbsoluteToolFilePathInput(filePath: string): ToolPathResolution
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
    if (!path.isAbsolute(trimmedPath))
    {
        return {
            ok: false,
            message: "Invalid params. 'filePath' must be an absolute file system path.",
            details: {
                filePath
            }
        };
    }

    const absolutePath = path.normalize(trimmedPath);
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

export function normalizeFindReferencesLimit(rawLimit: unknown): FindReferencesLimitResolution
{
    if (rawLimit === undefined || rawLimit === null)
    {
        return {
            ok: true,
            value: DEFAULT_FIND_REFERENCES_LIMIT
        };
    }
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit))
    {
        return {
            ok: false,
            message: `Invalid params. 'limit' must be an integer between 1 and ${MAX_FIND_REFERENCES_LIMIT}.`,
            details: {
                receivedLimit: rawLimit
            }
        };
    }
    if (rawLimit < 1 || rawLimit > MAX_FIND_REFERENCES_LIMIT)
    {
        return {
            ok: false,
            message: `Invalid params. 'limit' must be between 1 and ${MAX_FIND_REFERENCES_LIMIT}.`,
            details: {
                receivedLimit: rawLimit
            }
        };
    }
    return {
        ok: true,
        value: rawLimit
    };
}

export function applyResultLimit<T>(items: readonly T[], limit: number): LimitedResult<T>
{
    const limitedItems = items.slice(0, limit);
    return {
        items: [...limitedItems],
        total: items.length,
        returned: limitedItems.length,
        limit,
        truncated: items.length > limit
    };
}

export function normalizeHierarchySourceFilePath(filePath: unknown): string | null
{
    if (typeof filePath !== 'string')
        return null;

    const trimmedPath = filePath.trim();
    if (!trimmedPath || !path.isAbsolute(trimmedPath))
        return null;

    return path.normalize(trimmedPath);
}
