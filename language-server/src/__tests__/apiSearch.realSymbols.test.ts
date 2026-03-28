import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test = require('node:test');
import * as scriptfiles from '../as_parser';
import {
    AddPrimitiveTypes,
    AddTypesFromUnreal,
    FinishTypesFromUnreal,
    OnDirtyTypeCaches,
    ResetDatabaseForTests
} from '../database';
import { GetAPISearch, InvalidateAPISearchCache } from '../api_search';

type RealSymbolFixtureCase = {
    id: string;
    mode: 'smart' | 'plain';
    query: string;
    topWindow: number;
    expectWithinTop: string[];
    expectFirst?: string;
};

type RealSymbolFixture = {
    metadata: {
        caseCount: number;
    };
    debugDatabaseChunks: Array<Record<string, unknown>>;
    cases: RealSymbolFixtureCase[];
};

const fixturePath = path.resolve(__dirname, '../../src/__tests__/fixtures/apiSearch.realSymbols.fixture.json');
const fixtureRaw = fs.readFileSync(fixturePath, 'utf8');

function loadRealSymbolFixture() : RealSymbolFixture
{
    return JSON.parse(fixtureRaw) as RealSymbolFixture;
}

const fixture = loadRealSymbolFixture();

function setupRealSymbolFixture() : void
{
    ResetDatabaseForTests();
    InvalidateAPISearchCache();

    for (const chunk of fixture.debugDatabaseChunks)
        AddTypesFromUnreal(chunk);
    FinishTypesFromUnreal();
    AddPrimitiveTypes(scriptfiles.GetScriptSettings().floatIsFloat64);

    OnDirtyTypeCaches();
    InvalidateAPISearchCache();
}

test.beforeEach(() =>
{
    setupRealSymbolFixture();
});

test('real-symbol fixture keeps the intended coverage budget', () =>
{
    assert.equal(fixture.cases.length, fixture.metadata.caseCount);
    assert.ok(fixture.cases.length >= 120);
    assert.ok(fixture.cases.length <= 180);
    assert.ok(fixture.debugDatabaseChunks.length >= 15);
});

test('real-symbol fixture metadata is path-masked', () =>
{
    const normalizedFixture = fixtureRaw.toLowerCase();
    assert.equal(normalizedFixture.includes('cthulhuproject'), false);
    assert.equal(normalizedFixture.includes('cthulhugame'), false);
    assert.equal(normalizedFixture.includes('sourcecachepath"'), false);
    assert.equal(normalizedFixture.includes('sourcecachepathmasked'), true);
});

for (const testCase of fixture.cases)
{
    test(`real-symbol search: ${testCase.id}`, () =>
    {
        const result = GetAPISearch({
            query: testCase.query,
            mode: testCase.mode,
            limit: Math.max(testCase.topWindow, 20)
        });

        const topMatches = result.matches
            .slice(0, testCase.topWindow)
            .map((match) => match.qualifiedName);

        for (const expectedQualifiedName of testCase.expectWithinTop)
        {
            assert.ok(
                topMatches.includes(expectedQualifiedName),
                `Expected ${expectedQualifiedName} within top ${testCase.topWindow} for "${testCase.query}", got ${topMatches.join(', ')}`
            );
        }

        if (testCase.expectFirst)
            assert.equal(result.matches[0]?.qualifiedName, testCase.expectFirst);
    });
}
