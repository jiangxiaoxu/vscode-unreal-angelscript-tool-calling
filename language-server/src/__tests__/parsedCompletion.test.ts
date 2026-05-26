import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test = require('node:test');
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import * as scriptfiles from '../as_parser';
import {
    AddPrimitiveTypes,
    AddTypeToDatabase,
    DBMethod,
    DBType,
    GetRootNamespace,
    ResetDatabaseForTests
} from '../database';
import { Complete } from '../parsed_completion';

let moduleCounter = 0;

function createResolvedModule(content: string, setupDatabase?: () => void): scriptfiles.ASModule
{
    ResetDatabaseForTests();
    scriptfiles.ClearAllResolvedModules();
    AddPrimitiveTypes(scriptfiles.GetScriptSettings().floatIsFloat64);
    setupDatabase?.();

    moduleCounter += 1;
    const filePath = path.join(os.tmpdir(), `parsed-completion-${moduleCounter}.as`);
    const uri = URI.file(filePath).toString();
    const moduleName = `Parsed.Completion.${moduleCounter}`;
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

function completeAt(asmodule: scriptfiles.ASModule, content: string, snippet: string, offsetWithinSnippet: number, occurrence: number = 1): Array<CompletionItem>
{
    return Complete(asmodule, positionFor(content, snippet, offsetWithinSnippet, occurrence)) ?? [];
}

function findCompletion(completions: Array<CompletionItem>, label: string): CompletionItem | undefined
{
    return completions.find((completion) => completion.label == label);
}

function createNativeMethod(name: string, returnType: string): DBMethod
{
    const method = new DBMethod();
    method.name = name;
    method.returnType = returnType;
    method.declaredModule = null;
    method.documentation = null;
    method.args = [];
    return method;
}

function createNativeType(name: string, methods: Array<DBMethod>): DBType
{
    const namespace = GetRootNamespace();
    const dbType = new DBType().initEmpty(name);
    dbType.namespace = namespace;
    dbType.declaredModule = null;

    for (const method of methods)
        dbType.addSymbol(method);

    AddTypeToDatabase(namespace, dbType);
    return dbType;
}

function createFixture()
{
    const content = [
        'class UContextValue',
        '{',
        '    void Activate() {}',
        '}',
        '',
        'class UOwner',
        '{',
        '    UContextValue ContextValue;',
        '    UContextValue GetContext() property { return ContextValue; }',
        '',
        '    void Run()',
        '    {',
        '        UOwner Owner;',
        '        Owner.Context;',
        '        Owner.GetContext;',
        '        Owner.Context.',
        '    }',
        '}',
    ].join('\n');

    return {
        content,
        asmodule: createResolvedModule(content)
    };
}

function createNativeLegacyGetClassFixture()
{
    const content = [
        'void Run()',
        '{',
        '    UOwner Owner;',
        '    Owner.Class;',
        '    Owner.GetClass;',
        '    Owner.Class.',
        '}',
    ].join('\n');

    return {
        content,
        asmodule: createResolvedModule(content, () =>
        {
            createNativeType('UClass', [
                createNativeMethod('FindFunction', 'void'),
            ]);
            createNativeType('UOwner', [
                createNativeMethod('GetClass', 'UClass'),
            ]);
        })
    };
}

test('property accessor completion matches the property name and keeps method form hidden', () =>
{
    const fixture = createFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.Context;',
        'Owner.Context'.length
    );

    const contextCompletion = findCompletion(completions, 'Context');
    assert.ok(contextCompletion);
    assert.equal(contextCompletion.kind, CompletionItemKind.Field);
    assert.equal(contextCompletion.labelDetails?.description, 'UContextValue');
    assert.match(contextCompletion.filterText ?? '', /\bContext\b/);
    assert.match(contextCompletion.filterText ?? '', /\bGetContext\b/);
    assert.equal(findCompletion(completions, 'GetContext'), undefined);
});

test('property accessor completion still matches getter-style input', () =>
{
    const fixture = createFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.GetContext;',
        'Owner.GetContext'.length
    );

    const contextCompletion = findCompletion(completions, 'Context');
    assert.ok(contextCompletion);
    assert.equal(contextCompletion.kind, CompletionItemKind.Field);
    assert.equal(findCompletion(completions, 'GetContext'), undefined);
});

test('member completion works after a property accessor chain', () =>
{
    const fixture = createFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.Context.',
        'Owner.Context.'.length
    );

    const activateCompletion = findCompletion(completions, 'Activate');
    assert.ok(activateCompletion);
    assert.equal(activateCompletion.kind, CompletionItemKind.Method);
});

test('native legacy GetClass accessor completes as Class without isProperty', () =>
{
    const fixture = createNativeLegacyGetClassFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.Class;',
        'Owner.Class'.length
    );

    const classCompletion = findCompletion(completions, 'Class');
    assert.ok(classCompletion);
    assert.equal(classCompletion.kind, CompletionItemKind.Field);
    assert.equal(classCompletion.labelDetails?.description, 'UClass');
    assert.match(classCompletion.filterText ?? '', /\bClass\b/);
    assert.match(classCompletion.filterText ?? '', /\bGetClass\b/);
    assert.ok(findCompletion(completions, 'GetClass'));
});

test('native legacy GetClass accessor keeps callable completion available', () =>
{
    const fixture = createNativeLegacyGetClassFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.GetClass;',
        'Owner.GetClass'.length
    );

    const classCompletion = findCompletion(completions, 'Class');
    assert.ok(classCompletion);
    assert.equal(classCompletion.kind, CompletionItemKind.Field);

    const getClassCompletion = findCompletion(completions, 'GetClass');
    assert.ok(getClassCompletion);
    assert.equal(getClassCompletion.kind, CompletionItemKind.Method);
});

test('member completion works after native legacy GetClass accessor chain', () =>
{
    const fixture = createNativeLegacyGetClassFixture();
    const completions = completeAt(
        fixture.asmodule,
        fixture.content,
        'Owner.Class.',
        'Owner.Class.'.length
    );

    const findFunctionCompletion = findCompletion(completions, 'FindFunction');
    assert.ok(findFunctionCompletion);
    assert.equal(findFunctionCompletion.kind, CompletionItemKind.Method);
});
