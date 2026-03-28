import * as assert from 'node:assert/strict';
import test = require('node:test');
import { ApiSearchError, buildSearchPayload } from '../angelscriptApiSearch';
import {
    GetAPISearchLspResult,
    GetAPISearchRequest
} from '../apiRequests';

function createSearchResult(overrides?: Partial<GetAPISearchLspResult>): GetAPISearchLspResult
{
    return {
        matches: [],
        matchCounts: {
            total: 0,
            returned: 0,
            omitted: 0
        },
        ...overrides
    };
}

test('buildSearchPayload omits inherited-scope flag for auto mode and records applied class inheritance', async () =>
{
    const calls: Array<{ method: unknown; payload: unknown }> = [];
    const client = {
        sendRequest: async (method: unknown, payload: unknown) =>
        {
            calls.push({ method, payload });
            return createSearchResult({
                matches: [
                    {
                        qualifiedName: 'Gameplay::Movement::UMovementBase.TickMovement',
                        kind: 'method',
                        signature: 'void Gameplay::Movement::UMovementBase.TickMovement()',
                        source: 'native',
                        containerQualifiedName: 'Gameplay::Movement::UMovementBase',
                        scopeRelationship: 'inherited',
                        scopeDistance: 2
                    }
                ],
                matchCounts: {
                    total: 1,
                    returned: 1,
                    omitted: 0
                },
                scopeLookup: {
                    requestedScope: 'Gameplay::Movement::UMovementDerived',
                    resolvedQualifiedName: 'Gameplay::Movement::UMovementDerived',
                    resolvedKind: 'class'
                },
                inheritedScopeOutcome: 'applied'
            });
        }
    } as any;

    const data = await buildSearchPayload(client, {
        query: 'Movement',
        scope: 'Gameplay::Movement::UMovementDerived'
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, GetAPISearchRequest);
    assert.deepEqual(calls[0].payload, {
        query: 'Movement',
        mode: 'smart',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeDocs: false,
        symbolLevel: 'all'
    });
    assert.deepEqual(data.request, {
        query: 'Movement',
        mode: 'smart',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: true,
        includeDocs: false,
        symbolLevel: 'all'
    });
    assert.equal(data.matches[0]?.scopeRelationship, 'inherited');
});

test('buildSearchPayload preserves explicit false and reports explicit mode metadata', async () =>
{
    const calls: Array<unknown> = [];
    const client = {
        sendRequest: async (_method: unknown, payload: unknown) =>
        {
            calls.push(payload);
            return createSearchResult({
                scopeLookup: {
                    requestedScope: 'Gameplay::Movement::UMovementDerived',
                    resolvedQualifiedName: 'Gameplay::Movement::UMovementDerived',
                    resolvedKind: 'class'
                }
            });
        }
    } as any;

    const data = await buildSearchPayload(client, {
        query: 'Movement',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScope: false
    });

    assert.deepEqual(calls[0], {
        query: 'Movement',
        mode: 'smart',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScope: false,
        includeDocs: false,
        symbolLevel: 'all'
    });
    assert.deepEqual(data.request, {
        query: 'Movement',
        mode: 'smart',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScopeMode: 'explicit',
        includeInheritedFromScope: false,
        includeDocs: false,
        symbolLevel: 'all'
    });
});

test('buildSearchPayload keeps auto mode false for namespace scopes without ignored noise', async () =>
{
    const client = {
        sendRequest: async () =>
        {
            return createSearchResult({
                matches: [
                    {
                        qualifiedName: 'Gameplay::Movement::BuildMovementPath',
                        kind: 'function',
                        signature: 'void Gameplay::Movement::BuildMovementPath(FVector Target)',
                        source: 'script',
                        containerQualifiedName: 'Gameplay::Movement'
                    }
                ],
                matchCounts: {
                    total: 1,
                    returned: 1,
                    omitted: 0
                },
                scopeLookup: {
                    requestedScope: 'Gameplay::Movement',
                    resolvedQualifiedName: 'Gameplay::Movement',
                    resolvedKind: 'namespace'
                }
            });
        }
    } as any;

    const data = await buildSearchPayload(client, {
        query: 'Movement',
        scope: 'Gameplay::Movement'
    });

    assert.equal(data.inheritedScopeOutcome, undefined);
    assert.deepEqual(data.request, {
        query: 'Movement',
        mode: 'smart',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: false,
        includeDocs: false,
        symbolLevel: 'all'
    });
});

test('buildSearchPayload forwards explicit regex mode and echoes it in request metadata', async () =>
{
    const calls: Array<unknown> = [];
    const client = {
        sendRequest: async (_method: unknown, payload: unknown) =>
        {
            calls.push(payload);
            return createSearchResult();
        }
    } as any;

    const data = await buildSearchPayload(client, {
        query: '/Movement$/',
        mode: 'regex'
    });

    assert.deepEqual(calls[0], {
        query: '/Movement$/',
        mode: 'regex',
        limit: 20,
        source: 'both',
        includeDocs: false,
        symbolLevel: 'all'
    });
    assert.deepEqual(data.request, {
        query: '/Movement$/',
        mode: 'regex',
        limit: 20,
        source: 'both',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: false,
        includeDocs: false,
        symbolLevel: 'all'
    });
});

test('buildSearchPayload forwards explicit symbolLevel and kinds', async () =>
{
    const calls: Array<unknown> = [];
    const client = {
        sendRequest: async (_method: unknown, payload: unknown) =>
        {
            calls.push(payload);
            return createSearchResult({
                matches: [
                    {
                        qualifiedName: 'Gameplay::Movement::UMovementBase',
                        kind: 'class',
                        signature: 'class Gameplay::Movement::UMovementBase',
                        source: 'script',
                        matchedBy: 'member',
                        matchedByQualifiedName: 'Gameplay::Movement::UMovementBase.TickMovement',
                        matchedByKind: 'method'
                    }
                ]
            });
        }
    } as any;

    const data = await buildSearchPayload(client, {
        query: 'TickMovement',
        kinds: ['class'],
        symbolLevel: 'type'
    });

    assert.deepEqual(calls[0], {
        query: 'TickMovement',
        mode: 'smart',
        limit: 20,
        kinds: ['class'],
        source: 'both',
        includeDocs: false,
        symbolLevel: 'type'
    });
    assert.deepEqual(data.request, {
        query: 'TickMovement',
        mode: 'smart',
        limit: 20,
        kinds: ['class'],
        source: 'both',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: false,
        includeDocs: false,
        symbolLevel: 'type'
    });
    assert.equal(data.matches[0]?.matchedBy, 'member');
    assert.equal(data.matches[0]?.matchedByQualifiedName, 'Gameplay::Movement::UMovementBase.TickMovement');
});

test('buildSearchPayload rejects removed plain mode', async () =>
{
    await assert.rejects(
        () => buildSearchPayload({} as any, {
            query: 'Movement',
            mode: 'plain' as any
        }),
        (error: unknown) =>
        {
            assert.ok(error instanceof ApiSearchError);
            assert.equal(error.code, 'INVALID_MODE');
            assert.match(error.message, /Expected "smart" or "regex"/u);
            return true;
        }
    );
});
