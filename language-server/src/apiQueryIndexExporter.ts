import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as typedb from './database';
import * as scriptfiles from './as_parser';
import { ExportAPIMaterializedMemberOwners } from './api_docs';
import { createHash } from 'node:crypto';
import { ExportAPIQueryMaterializedIndex, GetAPIQuery, type ApiQueryMatch } from './api_query_engine';
import {
    API_QUERY_INDEX_SCHEMA,
    API_QUERY_INDEX_VERSION,
    ApiQueryIndexInheritanceEdge,
    ApiQueryIndexV1,
    computeApiQueryIndexRecordsHash,
    computeScriptContentRevision,
    encodeApiQueryIndex,
} from './apiQueryIndexRuntime';
import type { AtomicWriteOperations } from './debugDatabaseCacheV2';

function collectAllApiRecords() : ApiQueryMatch[]
{
    let records: ApiQueryMatch[] = [];
    let offset = 0;
    while (true)
    {
        let page = GetAPIQuery({
            query: '/.*/',
            mode: 'regex',
            source: 'both',
            includeDocs: true,
            includeNonPublic: true,
            limit: 1000,
            offset,
        });
        records.push(...page.data.matches);
        offset += page.data.returned;
        if (!page.data.truncated || page.data.returned == 0)
            break;
    }
    return records;
}

function collectInheritance() : ApiQueryIndexInheritanceEdge[]
{
    let result: ApiQueryIndexInheritanceEdge[] = [];
    for (let [, dbType] of typedb.GetAllTypesById())
    {
        if (dbType.isPrimitive || dbType.isDelegate || dbType.isEvent)
            continue;
        let superTypeName = dbType.supertype || dbType.unrealsuper;
        if (!superTypeName)
            continue;
        let superType = typedb.LookupType(dbType.namespace, superTypeName) ?? typedb.GetTypeByName(superTypeName);
        if (!superType)
            continue;
        result.push({
            type: dbType.getQualifiedTypenameInNamespace(null),
            superType: superType.getQualifiedTypenameInNamespace(null),
        });
    }
    result.sort((left, right) => left.type.localeCompare(right.type) || left.superType.localeCompare(right.superType));
    return result;
}

export function buildApiQueryIndex(
    projectIdentity: string,
    debugDatabaseRevision: string,
    producerHash: string
) : ApiQueryIndexV1
{
    let records = collectAllApiRecords();
    let materialized = ExportAPIQueryMaterializedIndex();
    let memberOwners = ExportAPIMaterializedMemberOwners();
    let inheritance = collectInheritance();
    let scriptFiles = scriptfiles.GetAllLoadedModules()
        .map((module) => ({
            module: module.modulename,
            path: module.filename ?? '',
            contentHash: createHash('sha256').update(module.content ?? '').digest('hex'),
        }))
        .sort((left, right) => left.module.localeCompare(right.module) || left.path.localeCompare(right.path));
    return {
        schema: API_QUERY_INDEX_SCHEMA,
        version: API_QUERY_INDEX_VERSION,
        projectIdentity,
        debugDatabaseRevision,
        scriptContentRevision: computeScriptContentRevision(scriptFiles),
        scriptFiles,
        producerHash,
        createdAt: new Date().toISOString(),
        recordsHash: computeApiQueryIndexRecordsHash(records, inheritance, materialized.entries, materialized.scopes, memberOwners),
        records,
        searchEntries: materialized.entries,
        scopes: materialized.scopes,
        memberOwners,
        inheritance,
    };
}

export function writeApiQueryIndexAtomic(
    filePath: string,
    index: ApiQueryIndexV1,
    operations: AtomicWriteOperations = fs,
) : void
{
    let directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    let tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try
    {
        descriptor = operations.openSync(tempPath, 'wx');
        operations.writeFileSync(descriptor, encodeApiQueryIndex(index));
        operations.fsyncSync(descriptor);
        operations.closeSync(descriptor);
        descriptor = undefined;
        operations.renameSync(tempPath, filePath);
    }
    finally
    {
        if (descriptor !== undefined)
        {
            try { operations.closeSync(descriptor); } catch {}
        }
        try { operations.unlinkSync(tempPath); } catch {}
    }
}
