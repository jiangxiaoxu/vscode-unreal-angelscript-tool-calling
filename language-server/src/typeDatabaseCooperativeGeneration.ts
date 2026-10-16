import * as scriptfiles from './as_parser';
import * as typedb from './database';
import type { DebugDatabaseAccessChunk } from './accessContract';

// Live 重建只在批次边界让出事件循环; startup 继续使用同步 generation 路径.
export function createTypeDatabaseBatch(check: () => void = () => {}) : () => Promise<void>
{
    let deadline = performance.now() + 8;
    return async () => {
        check();
        if (performance.now() >= deadline)
        {
            await new Promise<void>((resolve) => setImmediate(resolve));
            check();
            deadline = performance.now() + 8;
        }
    };
}

export async function resetTypeDatabaseCooperatively(check: () => void = () => {}) : Promise<void>
{
    const batch = createTypeDatabaseBatch(check);
    const snapshots = scriptfiles.GetAllLoadedModules().map((module) => ({ module, content: module.content }));
    typedb.ResetDatabaseForTests();
    for (let snapshot of snapshots)
    {
        scriptfiles.UpdateModuleFromContent(snapshot.module, snapshot.content);
        scriptfiles.ParseModule(snapshot.module);
        await batch();
    }
}

export async function hydrateTypeDatabaseGenerationCooperatively(
    chunks: readonly unknown[],
    floatIsFloat64: boolean,
    accessChunks: readonly DebugDatabaseAccessChunk[] = [],
    check: () => void = () => {},
) : Promise<void>
{
    const batch = createTypeDatabaseBatch(check);
    // 验证全部输入后才修改全局数据库, 保持同步路径的顺序.
    for (let chunk of chunks)
    {
        if (!chunk || typeof chunk != 'object' || Array.isArray(chunk))
            throw new Error('DebugDatabase chunk must be an object.');
        for (let key in chunk)
        {
            let record = (chunk as Record<string, unknown>)[key];
            if (!key || !record || typeof record != 'object' || Array.isArray(record))
                throw new Error('DebugDatabase contains an invalid type record.');
            await batch();
        }
    }
    await resetTypeDatabaseCooperatively(check);
    for (let chunk of chunks)
    {
        for (let key in chunk as Record<string, unknown>)
        {
            typedb.AddTypesFromUnreal({ [key]: (chunk as Record<string, unknown>)[key] });
            await batch();
        }
    }
    typedb.ApplyDebugDatabaseAccess(accessChunks);
    typedb.FinishTypesFromUnreal();
    typedb.AddPrimitiveTypes(floatIsFloat64);
    for (let module of scriptfiles.GetAllParsedModules())
    {
        scriptfiles.PostProcessModuleTypes(module);
        await batch();
    }
    check();
}

export async function resolveAllScriptModulesCooperatively(check: () => void = () => {}) : Promise<void>
{
    const batch = createTypeDatabaseBatch(check);
    for (let module of scriptfiles.GetAllParsedModules())
    {
        scriptfiles.ResolveModule(module);
        await batch();
    }
    check();
}
