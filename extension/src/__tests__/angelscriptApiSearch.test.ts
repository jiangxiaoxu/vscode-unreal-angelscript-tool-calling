import * as assert from 'node:assert/strict';
import test = require('node:test');
import { buildSearchPayload } from '../angelscriptApiSearch';
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
        mode: 'plain',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeDocs: false
    });
    assert.deepEqual(data.request, {
        query: 'Movement',
        regex: false,
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: true,
        includeDocs: false
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
        mode: 'plain',
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScope: false,
        includeDocs: false
    });
    assert.deepEqual(data.request, {
        query: 'Movement',
        regex: false,
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement::UMovementDerived',
        includeInheritedFromScopeMode: 'explicit',
        includeInheritedFromScope: false,
        includeDocs: false
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
        regex: false,
        limit: 20,
        source: 'both',
        scope: 'Gameplay::Movement',
        includeInheritedFromScopeMode: 'auto',
        includeInheritedFromScope: false,
        includeDocs: false
    });
});
