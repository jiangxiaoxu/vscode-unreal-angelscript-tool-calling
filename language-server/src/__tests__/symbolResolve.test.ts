import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test = require('node:test');
import { URI } from 'vscode-uri';
import * as scriptfiles from '../as_parser';
import { AddPrimitiveTypes, ResetDatabaseForTests } from '../database';
import { ResolveSymbolAtPosition } from '../symbols';

let moduleCounter = 0;

function createResolvedModule(content: string): scriptfiles.ASModule
{
    ResetDatabaseForTests();
    scriptfiles.ClearAllResolvedModules();
    AddPrimitiveTypes(scriptfiles.GetScriptSettings().floatIsFloat64);

    moduleCounter += 1;
    const filePath = path.join(os.tmpdir(), `resolve-symbol-${moduleCounter}.as`);
    const uri = URI.file(filePath).toString();
    const moduleName = `Resolve.Symbol.${moduleCounter}`;
    const asmodule = scriptfiles.GetOrCreateModule(moduleName, filePath, uri);
    scriptfiles.UpdateModuleFromContent(asmodule, content);
    scriptfiles.ParseModuleAndDependencies(asmodule);
    scriptfiles.PostProcessModuleTypesAndDependencies(asmodule);
    scriptfiles.ResolveModule(asmodule);
    return asmodule;
}

function positionFor(content: string, snippet: string, offsetWithinSnippet: number = 0, occurrence: number = 1)
{
    let index = -1;
    let searchFrom = 0;
    for (let i = 0; i < occurrence; i += 1)
    {
        index = content.indexOf(snippet, searchFrom);
        if (index == -1)
            throw new Error(`Snippet not found: ${snippet}`);
        searchFrom = index + snippet.length;
    }

    const targetIndex = index + offsetWithinSnippet;
    const prefix = content.slice(0, targetIndex);
    const lines = prefix.split(/\r?\n/);
    return {
        line: lines.length - 1,
        character: lines[lines.length - 1].length
    };
}

function createFixture()
{
    const content = [
        'namespace Gameplay::Movement',
        '{',
        '    /** Namespace function docs. */',
        '    void OpenDoor() {}',
        '',
        '    /** Test movement type docs. */',
        '    class UTestMovement',
        '    {',
        '        int Count;',
        '',
        '        /** Method docs. */',
        '        void StartMovement() {}',
        '',
        '        /** Accessor docs. */',
        '        int GetValue() property { return Count; }',
        '',
        '        void Run()',
        '        {',
        '            UTestMovement TypedInstance;',
        '            int LocalValue = 1;',
        '            LocalValue = LocalValue + 1;',
        '            Gameplay::Movement::OpenDoor();',
        '            TypedInstance.StartMovement();',
        '            TypedInstance.Value;',
        '        }',
        '    }',
        '}',
    ].join('\n');

    return {
        content,
        asmodule: createResolvedModule(content)
    };
}

test('ResolveSymbolAtPosition resolves type, namespace, local variable, method, and accessor symbols', () =>
{
    const fixture = createFixture();

    const typeResult = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, 'UTestMovement TypedInstance;'),
        true
    );
    assert.equal(typeResult.ok, true);
    if (typeResult.ok !== true)
        return;
    assert.equal(typeResult.symbol.kind, 'class');
    assert.equal(typeResult.symbol.name, 'UTestMovement');
    assert.match(typeResult.symbol.signature, /class UTestMovement/);
    assert.match(typeResult.symbol.doc?.text ?? '', /Test movement type docs/);

    const namespaceResult = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, 'Gameplay::Movement::OpenDoor();', 'Gameplay::'.length),
        true
    );
    assert.equal(namespaceResult.ok, true);
    if (namespaceResult.ok !== true)
        return;
    assert.equal(namespaceResult.symbol.kind, 'namespace');
    assert.equal(namespaceResult.symbol.name, 'Gameplay::Movement');

    const localResult = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, 'LocalValue = LocalValue + 1;', 'LocalValue = '.length, 1),
        true
    );
    assert.equal(localResult.ok, true);
    if (localResult.ok !== true)
        return;
    assert.equal(localResult.symbol.kind, 'variable');
    assert.equal(localResult.symbol.name, 'LocalValue');
    assert.equal(localResult.symbol.signature, 'int LocalValue');

    const methodResult = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, 'TypedInstance.StartMovement();', 'TypedInstance.'.length),
        true
    );
    assert.equal(methodResult.ok, true);
    if (methodResult.ok !== true)
        return;
    assert.equal(methodResult.symbol.kind, 'method');
    assert.equal(methodResult.symbol.name, 'StartMovement');
    assert.match(methodResult.symbol.signature, /UTestMovement\.StartMovement/);
    assert.match(methodResult.symbol.doc?.text ?? '', /Method docs/);

    const accessorResult = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, 'TypedInstance.Value;', 'TypedInstance.'.length),
        true
    );
    assert.equal(accessorResult.ok, true);
    if (accessorResult.ok !== true)
        return;
    assert.equal(accessorResult.symbol.kind, 'method');
    assert.equal(accessorResult.symbol.name, 'GetValue');
    assert.match(accessorResult.symbol.signature, /UTestMovement\.Value/);
    assert.match(accessorResult.symbol.doc?.text ?? '', /Accessor docs/);
});

test('ResolveSymbolAtPosition returns NotFound when there is no symbol at the requested position', () =>
{
    const fixture = createFixture();
    const result = ResolveSymbolAtPosition(
        fixture.asmodule,
        positionFor(fixture.content, '        {', 0, 1),
        true
    );

    assert.equal(result.ok, false);
    if (result.ok !== false)
        return;

    assert.equal(result.error.code, 'NotFound');
});

test('ResolveSymbolAtPosition ignores commented-out code lines when building documentation', () =>
{
    const content = [
        'class UDocNoiseFixture',
        '{',
        '    // default MontageSlotName = n"OverrideFullBody";',
        '    void ActivateAbility() {}',
        '}',
    ].join('\n');

    const asmodule = createResolvedModule(content);
    const result = ResolveSymbolAtPosition(
        asmodule,
        positionFor(content, 'ActivateAbility', 1, 1),
        true
    );

    assert.equal(result.ok, true);
    if (result.ok !== true)
        return;

    assert.equal(result.symbol.kind, 'method');
    assert.equal(result.symbol.name, 'ActivateAbility');
    assert.equal(result.symbol.doc, undefined);
});
