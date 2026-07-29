import * as fs from 'node:fs';

export type LegacyCacheCleanupResult =
    | { ok: true; removed: boolean }
    | { ok: false; reason: string };

export function removeLegacyCacheAfterVerifiedPublish(filePath: string) : LegacyCacheCleanupResult
{
    let stat: fs.Stats;
    try { stat = fs.lstatSync(filePath); }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException).code == 'ENOENT')
            return { ok: true, removed: false };
        return { ok: false, reason: `Legacy cache inspection failed: ${String(error)}` };
    }
    if (!stat.isFile() || stat.isSymbolicLink())
        return { ok: false, reason: 'Legacy cache is not a regular non-reparse file.' };
    try
    {
        fs.unlinkSync(filePath);
        return { ok: true, removed: true };
    }
    catch (error)
    {
        return { ok: false, reason: `Legacy cache deletion failed: ${String(error)}` };
    }
}
