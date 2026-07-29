import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
    API_QUERY_INDEX_SCHEMA,
    API_QUERY_INDEX_VERSION,
    computeApiQueryIndexRecordsHash,
    computeScriptContentRevision,
    decodeApiQueryIndex,
    encodeApiQueryIndex,
    getApiQueryIndexHierarchy,
    getApiQueryIndexMembers,
    queryApiQueryIndex,
    readApiQueryIndexSymbol,
    validateApiQueryIndexCompatibility,
    type ApiQueryIndexV1,
} from '../apiQueryIndexRuntime';
import type { ApiQueryMatch } from '../api_query_engine';
import { writeApiQueryIndexAtomic } from '../apiQueryIndexExporter';
import type { AtomicWriteOperations } from '../debugDatabaseCacheV2';

const records: ApiQueryMatch[] = [
    { qualifiedName: 'AActor', shortName: 'AActor', namespaceQualifiedName: '', kind: 'class', signature: 'class AActor', source: 'native', visibility: 'public' },
    { qualifiedName: 'AActor.GetActorLocation', shortName: 'GetActorLocation', namespaceQualifiedName: '', kind: 'method', signature: 'FVector AActor.GetActorLocation() const', source: 'native', visibility: 'public', ownerQualifiedName: 'AActor', containerQualifiedName: 'AActor', documentation: 'Returns the actor location.' },
    { qualifiedName: 'AMyActor', shortName: 'AMyActor', namespaceQualifiedName: '', kind: 'class', signature: 'class AMyActor', source: 'script', visibility: 'public' },
];

function makeIndex() : ApiQueryIndexV1
{
    let inheritance = [{ type: 'AMyActor', superType: 'AActor' }];
    let scriptFiles: Array<{ module: string; path: string; contentHash: string }> = [];
    return {
        schema: API_QUERY_INDEX_SCHEMA,
        version: API_QUERY_INDEX_VERSION,
        projectIdentity: 'project-a',
        debugDatabaseRevision: 'revision-a',
        scriptContentRevision: computeScriptContentRevision(scriptFiles),
        scriptFiles,
        producerHash: 'producer-a',
        createdAt: new Date(0).toISOString(),
        recordsHash: computeApiQueryIndexRecordsHash(records, inheritance, [], [], []),
        records,
        searchEntries: [],
        scopes: [],
        memberOwners: [],
        inheritance,
    };
}

test('pure API index runtime round-trips and supports query, exact read, members, and hierarchy', () => {
    let decoded = decodeApiQueryIndex(encodeApiQueryIndex(makeIndex()));
    let query = queryApiQueryIndex(decoded, { query: 'actor location', includeDocs: true });
    assert.equal(query.data.matches[0].qualifiedName, 'AActor.GetActorLocation');
    let exact = readApiQueryIndexSymbol(decoded, { name: 'AActor.GetActorLocation', includeDocs: true });
    assert.equal(exact.ok, true);
    assert.equal(getApiQueryIndexMembers(decoded, 'AActor').length, 1);
    assert.deepEqual(getApiQueryIndexHierarchy(decoded, 'AMyActor'), { supertypes: ['AActor'], subtypes: [] });
    assert.deepEqual(getApiQueryIndexHierarchy(decoded, 'AActor'), { supertypes: [], subtypes: ['AMyActor'] });
});

test('pure API index runtime detects tampering', () => {
    let index = makeIndex();
    index.records[0].signature = 'tampered';
    assert.throws(() => encodeApiQueryIndex(index), /hash mismatch/);
});

test('API query index compatibility fences native and script revisions', () => {
    let index = makeIndex();
    validateApiQueryIndexCompatibility(index, {
        projectIdentity: 'project-a',
        debugDatabaseRevision: 'revision-a',
        scriptContentRevision: index.scriptContentRevision,
        producerHash: 'producer-a',
    });
    assert.throws(() => validateApiQueryIndexCompatibility(index, {
        projectIdentity: 'project-a',
        debugDatabaseRevision: 'revision-b',
        scriptContentRevision: index.scriptContentRevision,
    }), /DebugDatabase revision mismatch/);
    assert.throws(() => validateApiQueryIndexCompatibility(index, {
        projectIdentity: 'project-a',
        debugDatabaseRevision: 'revision-a',
        scriptContentRevision: 'script-b',
    }), /script content revision mismatch/);
});

test('pure API index runtime bundle is standalone and does not embed the global TypeDB', () => {
    let bundlePath = path.resolve('language-server', 'dist', 'api-query-index.js');
    assert.equal(fs.existsSync(bundlePath), true);
    let bundle = fs.readFileSync(bundlePath, 'utf8');
    assert.equal(bundle.includes('GetAllTypesById'), false);
    assert.equal(bundle.includes('AddTypesFromUnreal'), false);
    assert.match(bundle, /queryApiQueryIndex/);
});

test('API index atomic writer cleans GUID temp files after write and fsync failures', () => {
    for (let stage of ['write', 'fsync'] as const)
    {
        let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'as-index-atomic-'));
        try
        {
            let operations: AtomicWriteOperations = {
                openSync: fs.openSync,
                writeFileSync: (stage == 'write' ? (() => { throw new Error('injected write failure'); }) : fs.writeFileSync) as typeof fs.writeFileSync,
                fsyncSync: (stage == 'fsync' ? (() => { throw new Error('injected fsync failure'); }) : fs.fsyncSync) as typeof fs.fsyncSync,
                closeSync: fs.closeSync,
                renameSync: fs.renameSync,
                unlinkSync: fs.unlinkSync,
            };
            assert.throws(
                () => writeApiQueryIndexAtomic(path.join(directory, 'api-query-index.v1.json.gz'), makeIndex(), operations),
                new RegExp(`injected ${stage} failure`),
            );
            assert.deepEqual(fs.readdirSync(directory), []);
        }
        finally
        {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }
});
