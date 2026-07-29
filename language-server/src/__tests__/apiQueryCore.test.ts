import * as assert from 'node:assert/strict';
import test = require('node:test');
import {
    AddTypeToDatabase,
    DBArg,
    DBMethod,
    DBNamespace,
    DBNamespaceDeclaration,
    DBProperty,
    DBType,
    FinishTypesFromUnreal,
    GetRootNamespace,
    OnDirtyTypeCaches,
    ResetDatabaseForTests,
} from '../database';
import {
    GetAPIExactSymbols,
    GetAPIQuery,
    GetAPISearch,
} from '../api_search';
import {
    GetAPIClassHierarchy,
    GetAPISymbolMembers,
} from '../api_docs';
import { registerApiRequestHandlers } from '../apiRequestHandlers';

function namespace(qualifiedName: string, declaredModule?: string | null): DBNamespace
{
    let current = GetRootNamespace();
    for (const part of qualifiedName.split('::').filter(Boolean))
    {
        let child = current.findChildNamespace(part);
        if (!child)
        {
            child = new DBNamespace();
            child.name = part;
            current.addChildNamespace(child);
        }
        const declaration = new DBNamespaceDeclaration();
        declaration.declaredModule = declaredModule ?? null;
        child.addScriptDeclaration(declaration);
        current = child;
    }
    return current;
}

function method(
    name: string,
    declaredModule: string | null,
    args: Array<{ type: string; name: string; defaultValue?: string }> = [],
    options: { returnType?: string; callable?: boolean; private?: boolean; protected?: boolean; property?: boolean; mixin?: boolean } = {}
): DBMethod
{
    const value = new DBMethod();
    value.name = name;
    value.returnType = options.returnType ?? 'void';
    value.declaredModule = declaredModule;
    value.args = args.map((arg) => new DBArg().init(arg.type, arg.name, arg.defaultValue));
    value.isCallable = options.callable !== false;
    value.isPrivate = options.private === true;
    value.isProtected = options.protected === true;
    value.isProperty = options.property === true;
    value.isMixin = options.mixin === true;
    value.documentation = `${name} docs.`;
    return value;
}

function property(name: string, declaredModule: string | null, isPrivate = false): DBProperty
{
    const value = new DBProperty();
    value.name = name;
    value.typename = 'int';
    value.declaredModule = declaredModule;
    value.isPrivate = isPrivate;
    value.documentation = `${name} docs.`;
    return value;
}

function type(
    owner: DBNamespace,
    name: string,
    options: { module?: string | null; supertype?: string; struct?: boolean; methods?: DBMethod[]; properties?: DBProperty[] } = {}
): DBType
{
    const value = new DBType().initEmpty(name);
    value.namespace = owner;
    value.declaredModule = options.module ?? null;
    value.supertype = options.supertype ?? null;
    value.isStruct = options.struct === true;
    value.documentation = `${name} docs.`;
    for (const entry of options.methods ?? [])
        value.addSymbol(entry);
    for (const entry of options.properties ?? [])
        value.addSymbol(entry);
    AddTypeToDatabase(owner, value);
    return value;
}

function constructor(
    ownerName: string,
    args: Array<{ type: string; name: string; defaultValue?: string }>,
    visibility: 'public' | 'protected' | 'private' = 'public'
): DBMethod
{
    const value = method(ownerName, null, args);
    value.isConstructor = true;
    value.returnType = ownerName;
    value.isProtected = visibility === 'protected';
    value.isPrivate = visibility === 'private';
    return value;
}

function setup(): void
{
    ResetDatabaseForTests();
    const core = namespace('Core', null);
    const coreScriptDeclaration = new DBNamespaceDeclaration();
    coreScriptDeclaration.declaredModule = 'Game.Core';
    core.addScriptDeclaration(coreScriptDeclaration);
    const shadow = namespace('Core::FThing', 'Game.Core');
    shadow.addSymbol(method('Build', 'Game.Core'));
    shadow.addSymbol(method('B', 'Game.Core', [], { callable: false, property: true, returnType: 'int' }));
    shadow.addSymbol(method('AMixinNamespace', 'Game.Core'));

    const base = type(core, 'UBase', {
        methods: [method('Tick', null)],
        properties: [property('BaseValue', null)],
    });
    void base;
    type(core, 'UDerived', {
        module: 'Game.Core',
        supertype: 'UBase',
        methods: [
            constructor('UDerived', []),
            method('Run', 'Game.Core'),
            method('GetValue', 'Game.Core', [], { callable: false, property: true, returnType: 'int' }),
            method('Secret', 'Game.Core', [], { private: true }),
        ],
    });
    type(core, 'UDerivedA', { module: 'Game.Core', supertype: 'UBase' });
    type(core, 'UDerivedB', { module: 'Game.Core', supertype: 'UBase' });
    const state = type(core, 'EState');
    state.isEnum = true;

    const ctor0 = constructor('FThing', []);
    const ctor1 = constructor('FThing', [{ type: 'int', name: 'Value', defaultValue: '0' }]);
    const protectedCtor = constructor('FThing', [{ type: 'double', name: 'Value' }], 'protected');
    const privateCtor = constructor('FThing', [{ type: 'bool', name: 'Value' }], 'private');
    privateCtor.declaredModule = 'Game.Core';
    const copy = constructor('FThing', [{ type: 'FThing', name: 'Other' }]);
    type(core, 'FThing', {
        struct: true,
        methods: [
            ctor0,
            ctor1,
            protectedCtor,
            privateCtor,
            copy,
            method('A', null),
            method('Zzz', null, [], { callable: false, property: true, returnType: 'int' }),
            method('AMixinFallback', null),
            method('DoThing', null),
            method('StaticClass', null),
            method('opAdd', null),
        ],
        properties: [property('Count', null)],
    });
    type(core, 'FCollision', {
        struct: true,
        methods: [
            constructor('FCollision', [{ type: 'T45542', name: 'Value' }]),
            constructor('FCollision', [{ type: 'T49425', name: 'Value' }]),
        ],
    });
    const other = namespace('Other', null);
    type(other, 'FThing', { struct: true, methods: [constructor('FThing', [])] });

    core.addSymbol(method('Overload', null, [{ type: 'int', name: 'Value' }]));
    core.addSymbol(method('Overload', null, [{ type: 'float', name: 'Value' }]));
    const duplicate = method('Duplicate', null);
    core.addSymbol(duplicate);
    core.addSymbol(duplicate);
    core.addSymbol(property('GlobalValue', null));
    core.addSymbol(method('ApplyBase', 'Game.Core', [{ type: 'UBase', name: 'Target' }], { mixin: true }));
    const mixins = namespace('Mixins', null);
    mixins.addSymbol(method('AMixin', 'Game.Core', [{ type: 'Core::FThing', name: 'Target' }], { mixin: true }));

    const delegate = type(core, 'FHiddenDelegate', { methods: [method('LeakedDelegateMethod', null)] });
    delegate.isDelegate = true;
    const event = type(core, 'FHiddenEvent', { methods: [method('LeakedEventMethod', null)] });
    event.isEvent = true;
    const primitive = type(core, 'FHiddenPrimitive', { methods: [method('LeakedPrimitiveMethod', null)] });
    primitive.isPrimitive = true;
    const templateInstance = type(core, 'THiddenTemplate<int>', { methods: [method('LeakedTemplateMethod', null)] });
    templateInstance.isTemplateInstantiation = true;

    OnDirtyTypeCaches();
}

test.beforeEach(setup);

test('GetAPIQuery supports core kinds, visibility, accessor projection, and dedupe before paging', () =>
{
    const namespaceResult = GetAPIQuery({ query: 'Core', kinds: ['namespace'], source: 'both', limit: 10 });
    assert.equal(namespaceResult.data.matches[0]?.source, 'both');
    const nativeNamespaceResult = GetAPIQuery({ query: 'Core', kinds: ['namespace'], source: 'native', limit: 10 });
    const scriptNamespaceResult = GetAPIQuery({ query: 'Core', kinds: ['namespace'], source: 'script', limit: 10 });
    assert.deepEqual(
        nativeNamespaceResult.data.matches.filter((match) => match.qualifiedName === 'Core').map((match) => [match.qualifiedName, match.source]),
        [['Core', 'both']]
    );
    assert.deepEqual(
        scriptNamespaceResult.data.matches.filter((match) => match.qualifiedName === 'Core').map((match) => [match.qualifiedName, match.source]),
        [['Core', 'both']]
    );

    const accessor = GetAPIQuery({ query: 'GetValue', kinds: ['property'], limit: 10 });
    assert.deepEqual(accessor.data.matches.map((match) => match.kind), ['property']);

    const hidden = GetAPIQuery({ query: 'Secret', kinds: ['method'], limit: 10 });
    assert.equal(hidden.data.total, 0);
    const visibleHidden = GetAPIQuery({ query: 'Secret', kinds: ['method'], includeNonPublic: true, limit: 10 });
    assert.equal(visibleHidden.data.matches[0]?.visibility, 'private');

    const overloads = GetAPIQuery({ query: 'Overload', kinds: ['function'], limit: 10 });
    assert.equal(overloads.data.total, 2);
    const duplicate = GetAPIQuery({ query: 'Duplicate', kinds: ['function'], limit: 10 });
    assert.equal(duplicate.data.total, 1);

    const all = GetAPIQuery({ query: 'Derived', limit: 100 });
    const page = GetAPIQuery({ query: 'Derived', limit: 1, offset: 1 });
    assert.deepEqual(page.data.matches, all.data.matches.slice(1, 2));
    assert.equal(page.data.total, all.data.total);

    for (const excluded of ['StaticClass', 'opAdd', 'LeakedDelegateMethod', 'LeakedEventMethod', 'LeakedPrimitiveMethod', 'LeakedTemplateMethod'])
        assert.equal(GetAPIQuery({ query: excluded, limit: 10 }).data.total, 0, excluded);
});

test('GetAPIQuery applies scoped inheritance modes before totals and paging', () =>
{
    const regex = GetAPIQuery({ query: '/Run$/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(regex.data.matches.map((match) => match.qualifiedName), ['Core::UDerived.Run']);

    const query = '/(Run|Tick|ApplyBase)$/';
    const defaults = GetAPIQuery({ query, mode: 'regex', scope: 'Core::UDerived', limit: 10 });
    assert.deepEqual(
        defaults.data.matches.map((match) => [match.shortName, match.scopeRelationship]),
        [['Run', 'declared'], ['Tick', 'inherited'], ['ApplyBase', 'mixin']]
    );

    const excludeInherited = GetAPIQuery({
        query,
        mode: 'regex',
        scope: 'Core::UDerived',
        excludeInherited: true,
        limit: 1,
        offset: 1,
    });
    assert.equal(excludeInherited.data.total, 2);
    assert.equal(excludeInherited.data.returned, 1);
    assert.equal(excludeInherited.data.omitted, 1);
    assert.equal(excludeInherited.data.matches[0]?.scopeRelationship, 'mixin');

    const declaredOnly = GetAPIQuery({
        query,
        mode: 'regex',
        scope: 'Core::UDerived',
        declaredOnly: true,
        limit: 10,
    });
    assert.deepEqual(
        declaredOnly.data.matches.map((match) => [match.shortName, match.scopeRelationship]),
        [['Run', 'declared']]
    );
});

test('GetAPIQuery validates scoped inheritance flags without changing legacy search', () =>
{
    assert.throws(
        () => GetAPIQuery({ query: 'Run', declaredOnly: true }),
        /'declaredOnly' and 'excludeInherited' require 'scope'/u
    );
    assert.throws(
        () => GetAPIQuery({ query: 'Run', excludeInherited: true }),
        /'declaredOnly' and 'excludeInherited' require 'scope'/u
    );
    assert.throws(
        () => GetAPIQuery({ query: 'Run', scope: 'Core::UDerived', declaredOnly: true, excludeInherited: true }),
        /cannot be combined/u
    );
    assert.throws(
        () => GetAPIQuery({ query: 'Run', scope: 'Core::UDerived', declaredOnly: 'true' as unknown as boolean }),
        /'declaredOnly' must be a boolean/u
    );
    assert.throws(
        () => GetAPIQuery({ query: 'Run', scope: 'Core::UDerived', excludeInherited: 1 as unknown as boolean }),
        /'excludeInherited' must be a boolean/u
    );

    const legacy = GetAPISearch({ query: 'ApplyBase', scope: 'Core::UDerived', declaredOnly: true, kinds: ['function'], limit: 10 });
    assert.equal(legacy.matches[0]?.scopeRelationship, 'mixin');
});

test('GetAPIQuery accepts scoped flags for namespace and non-class type scopes', () =>
{
    const namespaceResult = GetAPIQuery({
        query: 'Overload',
        scope: 'Core',
        declaredOnly: true,
        kinds: ['function'],
        limit: 10,
    });
    assert.ok(namespaceResult.data.matches.length > 0);
    assert.ok(namespaceResult.data.matches.every((match) => match.scopeRelationship == 'declared'));

    const structResult = GetAPIQuery({
        query: 'DoThing',
        scope: 'Core::FThing',
        excludeInherited: true,
        kinds: ['method'],
        limit: 10,
    });
    assert.deepEqual(structResult.data.matches.map((match) => match.qualifiedName), ['Core::FThing.DoThing']);
    assert.equal(structResult.data.matches[0]?.scopeRelationship, 'declared');

    const enumResult = GetAPIQuery({
        query: 'EState',
        scope: 'Core::EState',
        declaredOnly: true,
        kinds: ['enum'],
        limit: 10,
    });
    assert.deepEqual(enumResult.data.matches.map((match) => match.qualifiedName), ['Core::EState']);
    assert.equal(enumResult.data.matches[0]?.scopeRelationship, 'declared');
});

test('GetAPIQuery computes merged scope groups before global paging', () =>
{
    const result = GetAPIQuery({
        query: '/(DoThing|Build|Count)$/',
        mode: 'regex',
        scope: 'Core::FThing',
        declaredOnly: true,
        limit: 1,
        offset: 1,
    });
    assert.equal(result.data.total, 3);
    assert.equal(result.data.returned, 1);
    assert.equal(result.data.scopeGroups?.length, 2);
    assert.equal(result.data.scopeGroups?.reduce((sum, group) => sum + group.totalMatches, 0), 3);
    assert.equal(result.data.scopeGroups?.reduce((sum, group) => sum + group.matches.length, 0), 1);
    assert.equal(result.data.scopeGroups?.reduce((sum, group) => sum + group.omittedMatches, 0), 2);
    assert.deepEqual(result.data.matches.map((match) => match.qualifiedName), ['Core::FThing::Build']);
    const selectedGroup = result.data.scopeGroups?.find((group) => group.matches.length > 0);
    assert.equal(selectedGroup?.scope.resolvedKind, 'namespace');
    assert.deepEqual(selectedGroup?.matches.map((match) => match.qualifiedName), ['Core::FThing::Build']);
});

test('GetAPIQuery filters presentation kinds before merged owner seeding', () =>
{
    const first = GetAPIQuery({
        query: '/^(A|Zzz|B)$/',
        mode: 'regex',
        scope: 'Core::FThing',
        declaredOnly: true,
        kinds: ['property'],
        limit: 1,
        offset: 0,
    });
    const second = GetAPIQuery({
        query: '/^(A|Zzz|B)$/',
        mode: 'regex',
        scope: 'Core::FThing',
        declaredOnly: true,
        kinds: ['property'],
        limit: 1,
        offset: 1,
    });
    assert.deepEqual(first.data.matches.map((match) => match.qualifiedName), ['Core::FThing.Zzz']);
    assert.equal(first.data.scopeGroups?.find((group) => group.matches.length > 0)?.scope.resolvedKind, 'struct');
    assert.deepEqual(second.data.matches.map((match) => match.qualifiedName), ['Core::FThing::B']);
    assert.equal(second.data.scopeGroups?.find((group) => group.matches.length > 0)?.scope.resolvedKind, 'namespace');
});

test('GetAPIQuery filters mixins before merged owner seeding', () =>
{
    const first = GetAPIQuery({
        query: 'AMixin',
        scope: 'Core::FThing',
        declaredOnly: true,
        limit: 1,
        offset: 0,
    });
    const second = GetAPIQuery({
        query: 'AMixin',
        scope: 'Core::FThing',
        declaredOnly: true,
        limit: 1,
        offset: 1,
    });
    assert.deepEqual(first.data.matches.map((match) => match.qualifiedName), ['Core::FThing.AMixinFallback']);
    assert.equal(first.data.scopeGroups?.find((group) => group.matches.length > 0)?.scope.resolvedKind, 'struct');
    assert.deepEqual(second.data.matches.map((match) => match.qualifiedName), ['Core::FThing::AMixinNamespace']);
    assert.equal(second.data.scopeGroups?.find((group) => group.matches.length > 0)?.scope.resolvedKind, 'namespace');
    assert.ok(!first.data.matches.some((match) => match.scopeRelationship == 'mixin'));
    assert.ok(!second.data.matches.some((match) => match.scopeRelationship == 'mixin'));
});

test('GetAPIExactSymbols handles qualified and short collisions plus stable non-copy constructors', () =>
{
    const ambiguous = GetAPIExactSymbols({ name: 'FThing', kind: 'struct' });
    assert.equal(ambiguous.ok, true);
    if (!ambiguous.ok)
        return;
    assert.deepEqual(ambiguous.data.symbols.map((symbol) => symbol.qualifiedName), ['Core::FThing', 'Other::FThing']);

    const qualified = GetAPIExactSymbols({ name: 'Core::FThing', kind: 'struct' });
    assert.equal(qualified.ok, true);
    const missingQualified = GetAPIExactSymbols({ name: 'Missing::FThing', kind: 'struct' });
    assert.equal(missingQualified.ok, false);

    const constructors = GetAPIExactSymbols({ name: 'Core::FThing.FThing', kind: 'constructor' });
    assert.equal(constructors.ok, true);
    if (!constructors.ok)
        return;
    assert.equal(constructors.data.symbols.length, 2);
    assert.ok(constructors.data.symbols.every((symbol) => /^[0-9a-f]{64}$/u.test(symbol.symbolId ?? '')));
    assert.ok(constructors.data.symbols.every((symbol) => /^[0-9a-f]{8,64}$/u.test(symbol.symbolIdPrefix ?? '')));
    assert.ok(constructors.data.symbols.every((symbol) => symbol.symbolId?.startsWith(symbol.symbolIdPrefix ?? '')));
    assert.equal(new Set(constructors.data.symbols.map((symbol) => symbol.symbolIdPrefix)).size, 2);
    assert.deepEqual(constructors.data.symbols.map((symbol) => symbol.args?.length), [0, 1]);
    assert.ok(constructors.data.symbols.every((symbol) => symbol.visibility === 'public'));
    const nonPublicConstructors = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        kind: 'constructor',
        includeNonPublic: true,
    });
    assert.equal(nonPublicConstructors.ok, true);
    if (nonPublicConstructors.ok)
    {
        assert.equal(nonPublicConstructors.data.symbols.length, 4);
        assert.deepEqual(
            [...new Set(nonPublicConstructors.data.symbols.map((symbol) => symbol.visibility))].sort(),
            ['private', 'protected', 'public']
        );
    }
    const publicConstructorQuery = GetAPIQuery({ query: 'Core::FThing.FThing', kinds: ['constructor'], limit: 10 });
    const allConstructorQuery = GetAPIQuery({
        query: 'Core::FThing.FThing',
        kinds: ['constructor'],
        includeNonPublic: true,
        limit: 10,
    });
    const scriptConstructorQuery = GetAPIQuery({
        query: 'Core::FThing.FThing',
        kinds: ['constructor'],
        source: 'script',
        includeNonPublic: true,
        limit: 10,
    });
    assert.equal(publicConstructorQuery.data.total, 2);
    assert.equal(allConstructorQuery.data.total, 4);
    assert.equal(scriptConstructorQuery.data.total, 1);
    const prefixesById = new Map(allConstructorQuery.data.matches.map((symbol) => [symbol.symbolId, symbol.symbolIdPrefix]));
    assert.ok(allConstructorQuery.data.matches.every((symbol) => /^[0-9a-f]{8,64}$/u.test(symbol.symbolIdPrefix ?? '')));
    assert.ok(publicConstructorQuery.data.matches.every((symbol) => symbol.symbolIdPrefix === prefixesById.get(symbol.symbolId)));
    assert.ok(scriptConstructorQuery.data.matches.every((symbol) => symbol.symbolIdPrefix === prefixesById.get(symbol.symbolId)));
    assert.ok(constructors.data.symbols.every((symbol) => symbol.symbolIdPrefix === prefixesById.get(symbol.symbolId)));
    const scopedConstructorQuery = GetAPIQuery({
        query: 'FThing',
        scope: 'Core::FThing',
        declaredOnly: true,
        kinds: ['constructor'],
        limit: 1,
    });
    assert.equal(scopedConstructorQuery.data.matches.length, 1);
    assert.equal(scopedConstructorQuery.data.matches[0].symbolIdPrefix,
        prefixesById.get(scopedConstructorQuery.data.matches[0].symbolId));
    assert.equal(scopedConstructorQuery.data.scopeGroups
        ?.find((group) => group.matches.length > 0)
        ?.matches[0].symbolIdPrefix, scopedConstructorQuery.data.matches[0].symbolIdPrefix);
    const selected = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        kind: 'constructor',
        symbolId: `  ${constructors.data.symbols[1].symbolIdPrefix?.toUpperCase()}  `,
    });
    assert.equal(selected.ok, true);
    if (selected.ok)
    {
        assert.equal(selected.data.symbols.length, 1);
        assert.equal(selected.data.symbols[0].symbolId, constructors.data.symbols[1].symbolId);
        assert.equal(selected.data.symbols[0].symbolIdPrefix, constructors.data.symbols[1].symbolIdPrefix);
    }
    const selectedByFullId = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        kind: 'constructor',
        symbolId: constructors.data.symbols[0].symbolId,
    });
    assert.equal(selectedByFullId.ok, true);
    const missingPrefix = GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: '00000000' });
    assert.equal(missingPrefix.ok, false);
    if (!missingPrefix.ok)
        assert.equal(missingPrefix.error.code, 'NotFound');
    const shortPrefix = GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 'abcdefg' });
    assert.equal(shortPrefix.ok, false);
    if (!shortPrefix.ok)
        assert.equal(shortPrefix.error.code, 'InvalidParams');
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 'bad' }).ok, false);
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 'g0000000' }).ok, false);
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: '' }).ok, false);
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 12345678 as any }).ok, false);
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 'a'.repeat(65) }).ok, false);
    const conflictingKind = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        kind: 'method',
        symbolId: constructors.data.symbols[0].symbolIdPrefix,
    });
    assert.equal(conflictingKind.ok, false);
    if (!conflictingKind.ok)
        assert.equal(conflictingKind.error.code, 'InvalidParams');
    assert.equal(GetAPIExactSymbols({ name: 'Core::UDerived.UDerived', kind: 'constructor', includeNonPublic: true }).ok, false);

    const collisionFamily = GetAPIExactSymbols({
        name: 'Core::FCollision.FCollision',
        kind: 'constructor',
        includeNonPublic: true,
    });
    assert.equal(collisionFamily.ok, true);
    if (collisionFamily.ok)
    {
        assert.deepEqual(collisionFamily.data.symbols.map((symbol) => symbol.symbolId?.substring(0, 8)), ['6e31bfec', '6e31bfec']);
        assert.deepEqual(collisionFamily.data.symbols.map((symbol) => symbol.symbolIdPrefix?.length), [9, 9]);
        assert.deepEqual(collisionFamily.data.symbols.map((symbol) => symbol.source), ['native', 'native']);
        const filteredCollision = GetAPIQuery({
            query: 'Core::FCollision.FCollision',
            kinds: ['constructor'],
            source: 'native',
            limit: 1,
        });
        assert.equal(filteredCollision.data.matches.length, 1);
        assert.equal(filteredCollision.data.matches[0].symbolIdPrefix?.length, 9);
        const ambiguousPrefix = GetAPIExactSymbols({
            name: 'Core::FCollision.FCollision',
            kind: 'constructor',
            symbolId: '6e31bfec',
        });
        assert.equal(ambiguousPrefix.ok, false);
        if (!ambiguousPrefix.ok)
        {
            assert.equal(ambiguousPrefix.error.code, 'InvalidParams');
            assert.match(ambiguousPrefix.error.message, /ambiguous/u);
        }
        const collisionSelected = GetAPIExactSymbols({
            name: 'Core::FCollision.FCollision',
            symbolId: collisionFamily.data.symbols[0].symbolIdPrefix?.toUpperCase(),
        });
        assert.equal(collisionSelected.ok, true);
        if (collisionSelected.ok)
            assert.equal(collisionSelected.data.symbols[0].symbolIdPrefix?.length, 9);
    }

    const hiddenConstructor = nonPublicConstructors.ok
        ? nonPublicConstructors.data.symbols.find((symbol) => symbol.source == 'script')
        : undefined;
    assert.ok(hiddenConstructor?.symbolIdPrefix);
    const selectedHidden = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        symbolId: hiddenConstructor?.symbolIdPrefix,
    });
    assert.equal(selectedHidden.ok, true);
    if (selectedHidden.ok)
    {
        assert.equal(selectedHidden.data.symbols[0].visibility, hiddenConstructor?.visibility);
        assert.equal(selectedHidden.data.symbols[0].source, hiddenConstructor?.source);
    }
    assert.equal(GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        symbolId: hiddenConstructor?.symbolIdPrefix,
        source: 'native',
    }).ok, true);
    assert.equal(GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        symbolId: constructors.data.symbols[0].symbolIdPrefix,
        source: 'script',
    }).ok, true);

    const constructorQuery = GetAPIQuery({ query: 'Core::FThing.FThing', kinds: ['constructor'], limit: 10 });
    assert.ok(constructorQuery.data.matches.every((symbol) => symbol.symbolIdPrefix === prefixesById.get(symbol.symbolId)));
    const legacyDetailsData = constructors.data.symbols[0].detailsData as any[];
    assert.deepEqual(legacyDetailsData?.slice(0, 3), ['constructor', 'FThing', 'Core']);
    assert.equal(legacyDetailsData[3], constructors.data.symbols[0].symbolId);

    const core = namespace('Core', null);
    type(core, 'FMany', {
        struct: true,
        methods: [
            constructor('FMany', [{ type: 'T102484', name: 'FirstCollision' }]),
            ...Array.from({ length: 999 }, (_, index) => constructor('FMany', [{
                type: `T2${index.toString().padStart(5, '0')}`,
                name: 'Value',
            }])),
            constructor('FMany', [{ type: 'T88812', name: 'LastCollision' }]),
        ],
    });
    type(core, 'FDuplicate', {
        struct: true,
        methods: [
            constructor('FDuplicate', [{ type: 'int', name: 'Zed', defaultValue: '9' }]),
            constructor('FDuplicate', [{ type: 'int', name: 'Alpha', defaultValue: '0' }]),
        ],
    });
    OnDirtyTypeCaches();

    const many = GetAPIExactSymbols({ name: 'Core::FMany.FMany', kind: 'constructor' });
    assert.equal(many.ok, true);
    if (many.ok)
    {
        assert.equal(many.data.symbols.length, 1001);
        const firstCollision = many.data.symbols.find((symbol) => symbol.args?.[0]?.type == 'T102484');
        const pageTwoCollision = many.data.symbols[1000];
        assert.equal(pageTwoCollision.args?.[0]?.type, 'T88812');
        assert.equal(firstCollision?.symbolId?.substring(0, 8), '155b4977');
        assert.equal(pageTwoCollision.symbolId?.substring(0, 8), '155b4977');
        assert.equal(firstCollision?.symbolIdPrefix?.length, 9);
        assert.equal(pageTwoCollision.symbolIdPrefix?.length, 9);
        const selectedPageTwoFull = GetAPIExactSymbols({
            name: 'Core::FMany.FMany',
            symbolId: pageTwoCollision.symbolId,
        });
        assert.equal(selectedPageTwoFull.ok, true);
        const selectedPageTwoPrefix = GetAPIExactSymbols({
            name: 'Core::FMany.FMany',
            symbolId: pageTwoCollision.symbolIdPrefix,
        });
        assert.equal(selectedPageTwoPrefix.ok, true);
    }

    const duplicateIdentity = GetAPIExactSymbols({ name: 'Core::FDuplicate.FDuplicate', kind: 'constructor' });
    assert.equal(duplicateIdentity.ok, true);
    if (duplicateIdentity.ok)
    {
        assert.equal(duplicateIdentity.data.symbols.length, 1);
        assert.match(duplicateIdentity.data.symbols[0].signature, /Alpha/u);
        const duplicateSelected = GetAPIExactSymbols({
            name: 'Core::FDuplicate.FDuplicate',
            symbolId: duplicateIdentity.data.symbols[0].symbolId,
        });
        assert.equal(duplicateSelected.ok, true);
        if (duplicateSelected.ok)
            assert.equal(duplicateSelected.data.symbols.length, 1);
    }
});

test('GetAPISymbolMembers returns ambiguity candidates and same-name namespace/type groups', () =>
{
    const ambiguous = GetAPISymbolMembers({ name: 'FThing', members: ['all'] });
    assert.equal(ambiguous.ok, true);
    if (!ambiguous.ok)
        return;
    assert.equal(ambiguous.data.groups.length, 0);
    assert.equal(ambiguous.data.symbols.length, 3);

    const grouped = GetAPISymbolMembers({
        name: 'Core::FThing',
        members: ['callable', 'data', 'constructor'],
        includeDocs: true,
        limit: 2,
    });
    assert.equal(grouped.ok, true, JSON.stringify(grouped));
    if (!grouped.ok)
        return;
    assert.deepEqual(grouped.data.groups.map((group) => group.owner), ['type', 'namespace']);
    assert.ok(grouped.data.groups.every((group) => group.members.limit === 2));
    const typeGroup = grouped.data.groups.find((group) => group.owner === 'type');
    assert.ok(typeGroup?.members.total >= 3);

    const inherited = GetAPISymbolMembers({ name: 'Core::UDerived', members: ['callable', 'data'], includeInherited: true, limit: 200 });
    assert.equal(inherited.ok, true);
    if (inherited.ok)
        assert.ok(inherited.data.groups[0].members.items.some((member) => member.inheritedFrom === 'Core::UBase'));

    const publicOnly = GetAPISymbolMembers({ name: 'Core::UDerived', members: ['callable'], limit: 200 });
    assert.equal(publicOnly.ok, true);
    if (publicOnly.ok)
        assert.ok(!publicOnly.data.groups[0].members.items.some((member) => member.name === 'Secret'));
    const withNonPublic = GetAPISymbolMembers({ name: 'Core::UDerived', members: ['callable'], includeNonPublic: true, limit: 200 });
    assert.equal(withNonPublic.ok, true);
    if (withNonPublic.ok)
        assert.ok(withNonPublic.data.groups[0].members.items.some((member) => member.name === 'Secret' && member.visibility === 'private'));

    const invalidConstructorOwner = GetAPISymbolMembers({
        name: 'Core::FThing',
        ownerKind: 'namespace',
        members: ['constructor'],
    });
    assert.equal(invalidConstructorOwner.ok, false);

    const publicConstructors = GetAPISymbolMembers({
        name: 'Core::FThing',
        ownerKind: 'type',
        members: ['constructor'],
        limit: 200,
    });
    const allConstructors = GetAPISymbolMembers({
        name: 'Core::FThing',
        ownerKind: 'type',
        members: ['constructor'],
        includeNonPublic: true,
        limit: 200,
    });
    const pagedConstructors = GetAPISymbolMembers({
        name: 'Core::FThing',
        ownerKind: 'type',
        members: ['constructor'],
        includeNonPublic: true,
        limit: 1,
        offset: 1,
    });
    assert.equal(publicConstructors.ok, true);
    assert.equal(allConstructors.ok, true);
    assert.equal(pagedConstructors.ok, true);
    if (publicConstructors.ok && allConstructors.ok && pagedConstructors.ok)
    {
        assert.equal(publicConstructors.data.groups[0].members.total, 2);
        assert.equal(allConstructors.data.groups[0].members.total, 4);
        assert.ok(allConstructors.data.groups[0].members.items.some((member) => member.visibility === 'private'));
        assert.ok(allConstructors.data.groups[0].members.items.some((member) => member.visibility === 'protected'));
        const prefixesById = new Map(allConstructors.data.groups[0].members.items
            .map((member) => [member.symbolId, member.symbolIdPrefix]));
        assert.ok(allConstructors.data.groups[0].members.items
            .every((member) => /^[0-9a-f]{8,64}$/u.test(member.symbolIdPrefix ?? '')));
        assert.ok(publicConstructors.data.groups[0].members.items
            .every((member) => member.symbolIdPrefix === prefixesById.get(member.symbolId)));
        assert.equal(pagedConstructors.data.groups[0].members.items[0].symbolIdPrefix,
            prefixesById.get(pagedConstructors.data.groups[0].members.items[0].symbolId));
    }
});

test('GetAPISymbolMembers filters type members by their declared source before paging', () =>
{
    const core = GetRootNamespace().findChildNamespace('Core');
    assert.ok(core);

    const nativeConstructor = constructor('FSourceOwner', []);
    const scriptConstructor = constructor('FSourceOwner', [{ type: 'int', name: 'Value' }]);
    scriptConstructor.declaredModule = 'Game.SourceOwner';
    const owner = type(core, 'FSourceOwner', {
        struct: true,
        methods: [
            nativeConstructor,
            scriptConstructor,
            method('NativeMethod', null),
            method('ScriptMethod', 'Game.SourceOwner'),
        ],
        properties: [
            property('NativeProperty', null),
            property('ScriptProperty', 'Game.SourceOwner'),
        ],
    });
    const nativeNested = new DBType().initEmpty('FNativeNested');
    nativeNested.declaredModule = null;
    nativeNested.isStruct = true;
    owner.addSymbol(nativeNested);
    const scriptNested = new DBType().initEmpty('FScriptNested');
    scriptNested.declaredModule = 'Game.SourceOwner';
    scriptNested.isStruct = true;
    owner.addSymbol(scriptNested);
    core.addSymbol(method('NativeSourceMixin', null, [{ type: 'Core::FSourceOwner', name: 'Target' }], { mixin: true }));
    core.addSymbol(method('ScriptSourceMixin', 'Game.SourceOwner', [{ type: 'Core::FSourceOwner', name: 'Target' }], { mixin: true }));
    OnDirtyTypeCaches();

    const read = (source: 'native' | 'script' | 'both', limit = 200, offset = 0) => GetAPISymbolMembers({
        name: 'Core::FSourceOwner',
        ownerKind: 'type',
        source,
        members: ['all'],
        limit,
        offset,
    });
    const native = read('native');
    const script = read('script');
    const both = read('both');
    assert.equal(native.ok, true, JSON.stringify(native));
    assert.equal(script.ok, true, JSON.stringify(script));
    assert.equal(both.ok, true, JSON.stringify(both));
    if (!native.ok || !script.ok || !both.ok)
        return;

    const nativeItems = native.data.groups[0].members.items;
    const scriptItems = script.data.groups[0].members.items;
    const bothItems = both.data.groups[0].members.items;
    assert.ok(nativeItems.length > 0);
    assert.ok(scriptItems.length > 0);
    assert.ok(nativeItems.every((member) => member.source === 'native'));
    assert.ok(scriptItems.every((member) => member.source === 'script'));
    assert.equal(bothItems.length, nativeItems.length + scriptItems.length);
    assert.ok(bothItems.some((member) => member.name === 'NativeMethod' && member.source === 'native'));
    assert.ok(bothItems.some((member) => member.name === 'ScriptMethod' && member.source === 'script'));
    assert.ok(bothItems.some((member) => member.name === 'NativeProperty' && member.source === 'native'));
    assert.ok(bothItems.some((member) => member.name === 'ScriptProperty' && member.source === 'script'));
    assert.ok(bothItems.some((member) => member.name === 'NativeSourceMixin' && member.source === 'native' && member.isMixin === true));
    assert.ok(bothItems.some((member) => member.name === 'ScriptSourceMixin' && member.source === 'script' && member.isMixin === true));
    assert.ok(bothItems.some((member) => member.name === 'FNativeNested' && member.source === 'native'));
    assert.ok(bothItems.some((member) => member.name === 'FScriptNested' && member.source === 'script'));
    assert.ok(bothItems.some((member) => member.kind === 'constructor' && member.source === 'native'));
    assert.ok(bothItems.some((member) => member.kind === 'constructor' && member.source === 'script'));

    const scriptPage = read('script', 1, 1);
    assert.equal(scriptPage.ok, true, JSON.stringify(scriptPage));
    if (scriptPage.ok)
    {
        assert.equal(scriptPage.data.groups[0].members.total, scriptItems.length);
        assert.deepEqual(scriptPage.data.groups[0].members.items, scriptItems.slice(1, 2));
    }

    const nativeInherited = GetAPISymbolMembers({
        name: 'Core::UDerived',
        ownerKind: 'type',
        source: 'native',
        members: ['data'],
        includeInherited: true,
        limit: 200,
    });
    assert.equal(nativeInherited.ok, true, JSON.stringify(nativeInherited));
    if (nativeInherited.ok)
    {
        assert.equal(nativeInherited.data.groups[0].ownerSource, 'script');
        assert.ok(nativeInherited.data.groups[0].members.items.some((member) =>
            member.name === 'BaseValue'
            && member.source === 'native'
            && member.inheritedFrom === 'Core::UBase'));
        assert.ok(nativeInherited.data.groups[0].members.items.every((member) => member.source === 'native'));
    }

    const emptyScriptView = GetAPISymbolMembers({
        name: 'Core::FCollision',
        ownerKind: 'type',
        source: 'script',
        members: ['all'],
        limit: 200,
    });
    assert.equal(emptyScriptView.ok, true, JSON.stringify(emptyScriptView));
    if (emptyScriptView.ok)
    {
        assert.equal(emptyScriptView.data.groups[0].ownerSource, 'native');
        assert.equal(emptyScriptView.data.groups[0].members.total, 0);
    }
});

test('GetAPISymbolMembers preserves namespace owner source resolution', () =>
{
    const native = GetAPISymbolMembers({
        name: 'Core', ownerKind: 'namespace', source: 'native', members: ['callable'], limit: 200,
    });
    const script = GetAPISymbolMembers({
        name: 'Core', ownerKind: 'namespace', source: 'script', members: ['callable'], limit: 200,
    });
    assert.equal(native.ok, true, JSON.stringify(native));
    assert.equal(script.ok, true, JSON.stringify(script));
    if (native.ok && script.ok)
    {
        assert.ok(native.data.groups[0].members.items.every((member) => member.source === 'native'));
        assert.ok(script.data.groups[0].members.items.every((member) => member.source === 'script'));
    }

    const missingSource = GetAPISymbolMembers({
        name: 'Other', ownerKind: 'namespace', source: 'script', members: ['all'], limit: 200,
    });
    assert.equal(missingSource.ok, false);
    if (!missingSource.ok)
        assert.equal(missingSource.error.code, 'NotFound');
});

test('GetAPIClassHierarchy uses source-qualified identities and reports depth and breadth truncation', () =>
{
    const result = GetAPIClassHierarchy({ name: 'Core::UBase', maxSuperDepth: 0, maxSubDepth: 1, maxSubBreadth: 1 });
    assert.equal(result.ok, true);
    if (!result.ok)
        return;
    assert.equal(result.data.root, 'native:Core::UBase');
    assert.deepEqual(Object.keys(result.data.derivedByParent), ['native:Core::UBase']);
    assert.equal(result.data.truncated.subBreadth, true);
    assert.equal(result.data.omitted.subBreadth, 2);

    const derived = GetAPIClassHierarchy({ name: 'Core::UDerived', source: 'script', maxSuperDepth: 1, maxSubDepth: 0 });
    assert.equal(derived.ok, true);
    if (derived.ok)
        assert.deepEqual(derived.data.superClasses, ['native:Core::UBase']);
});

test('core LSP handlers are registered and execute through the ready path', async () =>
{
    FinishTypesFromUnreal();
    const handlers = new Map<string, (params: any) => any>();
    const connection = {
        onRequest(name: string, handler: (params: any) => any): void
        {
            handlers.set(name, handler);
        },
    };
    registerApiRequestHandlers({
        connection: connection as any,
        isUnrealConnected: () => true,
    });
    for (const name of [
        'angelscript/queryAPI',
        'angelscript/readAPISymbol',
        'angelscript/getAPISymbolMembers',
        'angelscript/getAPIClassHierarchy',
    ])
        assert.ok(handlers.has(name));
    const result = await handlers.get('angelscript/queryAPI')?.({ query: 'Run', kinds: ['method'] });
    assert.equal(result?.ok, true);
    const invalid = await handlers.get('angelscript/queryAPI')?.({ query: '' });
    assert.equal(invalid?.code, 0);
});

test('API handlers return a bounded NotReady ResponseError when Unreal types never become ready', async () =>
{
    const handlers = new Map<string, (params: any) => any>();
    const connection = {
        onRequest(name: string, handler: (params: any) => any): void
        {
            handlers.set(name, handler);
        },
    };
    registerApiRequestHandlers({
        connection: connection as any,
        isUnrealConnected: () => false,
        typesReadyWait: { maxTries: 0, delayMs: 0 },
    });
    const requests: Array<[string, unknown]> = [
        ['angelscript/getAPI', ''],
        ['angelscript/getAPISearch', { query: 'Run' }],
        ['angelscript/getAPIDetails', ['type', 'FThing', 'Core', 'struct']],
        ['angelscript/getAPIDetailsBatch', []],
        ['angelscript/queryAPI', { query: 'Run' }],
        ['angelscript/readAPISymbol', { name: 'Core::FThing' }],
        ['angelscript/getAPISymbolMembers', { name: 'Core::FThing', members: ['all'] }],
        ['angelscript/getAPIClassHierarchy', { name: 'Core::UBase' }],
    ];
    for (const [name, params] of requests)
    {
        const result = await handlers.get(name)?.(params);
        assert.equal(result?.code, -32002, name);
        assert.match(result?.message ?? '', /NotReady/u, name);
    }
});
