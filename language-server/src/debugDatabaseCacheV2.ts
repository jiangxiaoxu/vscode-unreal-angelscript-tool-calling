import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AngelScriptLanguageServerBudgets, AngelScriptCacheAccess } from './languageServerContract';

export const DEBUG_DATABASE_CACHE_SCHEMA = 'unreal-angelscript-debug-database';
export const DEBUG_DATABASE_CACHE_VERSION = 2;

export type DebugDatabaseCacheProducer = {
    extensionVersion: string;
    languageServerCommit: string;
    engineVersion?: string;
    pluginVersion?: string;
};

export type DebugDatabaseCacheV2 = {
    schema: typeof DEBUG_DATABASE_CACHE_SCHEMA;
    version: typeof DEBUG_DATABASE_CACHE_VERSION;
    projectIdentity: string;
    revision: string;
    contentHash: string;
    createdAt: string;
    producer: DebugDatabaseCacheProducer;
    scriptSettings: Record<string, boolean>;
    engineSupportsCreateBlueprint: boolean;
    complete: true;
    debugDatabaseChunks: unknown[];
};

export type DebugDatabaseCacheLoadResult =
    | { ok: true; cache: DebugDatabaseCacheV2 }
    | { ok: false; code: 'missing' | 'compressed-budget' | 'uncompressed-budget' | 'invalid-gzip' | 'invalid-json' | 'invalid-schema' | 'identity-mismatch' | 'producer-mismatch' | 'hash-mismatch' | 'chunk-budget'; message: string };

export type DebugDatabaseCacheContext = {
    cachePath: string;
    access: AngelScriptCacheAccess;
    projectIdentity: string;
    budgets: AngelScriptLanguageServerBudgets;
    producerCompatibility?: {
        extensionVersionPrefix?: string;
        languageServerCommit?: string;
    };
};

export type AtomicWriteOperations = Pick<typeof fs,
    'openSync' | 'writeFileSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'unlinkSync'>;

function hashChunks(chunks: readonly unknown[]) : string
{
    return createHash('sha256').update(JSON.stringify(chunks)).digest('hex');
}

export function createDebugDatabaseRevision(chunks: readonly unknown[]) : string
{
    return hashChunks(chunks);
}

function isObject(value: unknown) : value is Record<string, unknown>
{
    return value != null && typeof value == 'object' && !Array.isArray(value);
}

export function loadDebugDatabaseCacheV2(context: DebugDatabaseCacheContext) : DebugDatabaseCacheLoadResult
{
    let compressed: Buffer;
    try
    {
        let stat = fs.statSync(context.cachePath);
        if (stat.size > context.budgets.maxCompressedBytes)
            return { ok: false, code: 'compressed-budget', message: `Cache exceeds compressed budget (${stat.size} bytes).` };
        compressed = fs.readFileSync(context.cachePath);
    }
    catch (error)
    {
        if ((error as NodeJS.ErrnoException)?.code == 'ENOENT')
            return { ok: false, code: 'missing', message: 'Cache file does not exist.' };
        return { ok: false, code: 'invalid-gzip', message: `Cache read failed: ${String(error)}` };
    }

    let plain: Buffer;
    try
    {
        plain = gunzipSync(compressed, { maxOutputLength: context.budgets.maxUncompressedBytes });
    }
    catch (error)
    {
        let message = String(error);
        let code = message.includes('larger than') || message.includes('maxOutputLength')
            ? 'uncompressed-budget' as const
            : 'invalid-gzip' as const;
        return { ok: false, code, message: `Cache decompression failed: ${message}` };
    }

    let parsed: unknown;
    try
    {
        parsed = JSON.parse(plain.toString('utf8'));
    }
    catch (error)
    {
        return { ok: false, code: 'invalid-json', message: `Cache JSON is invalid: ${String(error)}` };
    }
    if (!isObject(parsed)
        || parsed.schema != DEBUG_DATABASE_CACHE_SCHEMA
        || parsed.version != DEBUG_DATABASE_CACHE_VERSION
        || parsed.complete !== true
        || !Array.isArray(parsed.debugDatabaseChunks)
        || typeof parsed.projectIdentity != 'string'
        || typeof parsed.revision != 'string'
        || typeof parsed.contentHash != 'string'
        || !isObject(parsed.producer)
        || typeof parsed.producer.extensionVersion != 'string'
        || typeof parsed.producer.languageServerCommit != 'string'
        || !isObject(parsed.scriptSettings)
        || typeof parsed.engineSupportsCreateBlueprint != 'boolean')
        return { ok: false, code: 'invalid-schema', message: 'Cache envelope is incomplete or uses an unsupported schema.' };
    if (parsed.projectIdentity !== context.projectIdentity)
        return { ok: false, code: 'identity-mismatch', message: 'Cache project identity does not match this workspace.' };
    if (parsed.debugDatabaseChunks.length > context.budgets.maxChunkCount)
        return { ok: false, code: 'chunk-budget', message: `Cache exceeds chunk budget (${parsed.debugDatabaseChunks.length}).` };
    for (let [chunkIndex, chunk] of parsed.debugDatabaseChunks.entries())
    {
        if (!isObject(chunk) || Object.entries(chunk).some(([name, record]) => name.length == 0 || !isObject(record)))
            return { ok: false, code: 'invalid-schema', message: `Cache contains an invalid DebugDatabase chunk at index ${chunkIndex}.` };
    }
    let compatibility = context.producerCompatibility;
    if (compatibility?.extensionVersionPrefix
        && !parsed.producer.extensionVersion.startsWith(compatibility.extensionVersionPrefix))
        return { ok: false, code: 'producer-mismatch', message: 'Cache extension producer is incompatible.' };
    if (compatibility?.languageServerCommit
        && parsed.producer.languageServerCommit != compatibility.languageServerCommit)
        return { ok: false, code: 'producer-mismatch', message: 'Cache Language Server producer is incompatible.' };
    let contentHash = hashChunks(parsed.debugDatabaseChunks);
    if (contentHash != parsed.contentHash || parsed.revision != contentHash)
        return { ok: false, code: 'hash-mismatch', message: 'Cache content hash or revision does not match its chunks.' };
    return { ok: true, cache: parsed as DebugDatabaseCacheV2 };
}

function fsyncDirectory(directory: string) : void
{
    let descriptor: number | undefined;
    try
    {
        descriptor = fs.openSync(directory, 'r');
        fs.fsyncSync(descriptor);
    }
    catch
    {
        // Directory fsync is not supported by every Windows filesystem.
    }
    finally
    {
        if (descriptor !== undefined)
            fs.closeSync(descriptor);
    }
}

export function saveDebugDatabaseCacheV2(
    context: DebugDatabaseCacheContext,
    payload: Omit<DebugDatabaseCacheV2, 'schema' | 'version' | 'revision' | 'contentHash' | 'createdAt' | 'complete'>,
    operations: AtomicWriteOperations = fs,
) : DebugDatabaseCacheV2
{
    if (context.access != 'read-write')
        throw new Error('Cache is read-only for this Language Server role.');
    if (payload.debugDatabaseChunks.length == 0)
        throw new Error('Refusing to publish an empty debug database cache.');
    if (payload.debugDatabaseChunks.length > context.budgets.maxChunkCount)
        throw new Error(`Debug database exceeds chunk budget (${payload.debugDatabaseChunks.length}).`);
    for (let [chunkIndex, chunk] of payload.debugDatabaseChunks.entries())
    {
        if (!isObject(chunk) || Object.entries(chunk).some(([name, record]) => name.length == 0 || !isObject(record)))
            throw new Error(`Debug database contains an invalid chunk at index ${chunkIndex}.`);
    }
    if (payload.projectIdentity != context.projectIdentity)
        throw new Error('Debug database project identity does not match the cache context.');

    let contentHash = hashChunks(payload.debugDatabaseChunks);
    let envelope: DebugDatabaseCacheV2 = {
        schema: DEBUG_DATABASE_CACHE_SCHEMA,
        version: DEBUG_DATABASE_CACHE_VERSION,
        revision: contentHash,
        contentHash,
        createdAt: new Date().toISOString(),
        complete: true,
        ...payload,
    };
    let plain = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (plain.length > context.budgets.maxUncompressedBytes)
        throw new Error(`Debug database exceeds uncompressed budget (${plain.length}).`);
    let compressed = gzipSync(plain, { level: 6 });
    if (compressed.length > context.budgets.maxCompressedBytes)
        throw new Error(`Debug database exceeds compressed budget (${compressed.length}).`);

    let directory = path.dirname(context.cachePath);
    fs.mkdirSync(directory, { recursive: true });
    let tempPath = path.join(directory, `.${path.basename(context.cachePath)}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try
    {
        descriptor = operations.openSync(tempPath, 'wx');
        operations.writeFileSync(descriptor, compressed);
        operations.fsyncSync(descriptor);
        operations.closeSync(descriptor);
        descriptor = undefined;
        operations.renameSync(tempPath, context.cachePath);
        fsyncDirectory(directory);
    }
    finally
    {
        if (descriptor !== undefined)
        {
            try { operations.closeSync(descriptor); } catch {}
        }
        try { operations.unlinkSync(tempPath); } catch {}
    }
    return envelope;
}
