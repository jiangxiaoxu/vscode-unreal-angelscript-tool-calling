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

    const ctor0 = constructor('FThing', []);
    const ctor1 = constructor('FThing', [{ type: 'int', name: 'Value', defaultValue: '0' }]);
    const protectedCtor = constructor('FThing', [{ type: 'double', name: 'Value' }], 'protected');
    const privateCtor = constructor('FThing', [{ type: 'bool', name: 'Value' }], 'private');
    const copy = constructor('FThing', [{ type: 'FThing', name: 'Other' }]);
    type(core, 'FThing', {
        struct: true,
        methods: [ctor0, ctor1, protectedCtor, privateCtor, copy, method('DoThing', null), method('StaticClass', null), method('opAdd', null)],
        properties: [property('Count', null)],
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

test('GetAPIQuery retains smart, regex, scope, inherited, and mixin behavior', () =>
{
    const regex = GetAPIQuery({ query: '/Run$/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(regex.data.matches.map((match) => match.qualifiedName), ['Core::UDerived.Run']);

    const inherited = GetAPIQuery({ query: 'Tick', scope: 'Core::UDerived', kinds: ['method'], limit: 10 });
    assert.equal(inherited.data.matches[0]?.scopeRelationship, 'inherited');
    const declaredOnly = GetAPIQuery({ query: 'Tick', scope: 'Core::UDerived', declaredOnly: true, kinds: ['method'], limit: 10 });
    assert.equal(declaredOnly.data.total, 0);

    const mixin = GetAPIQuery({ query: 'ApplyBase', scope: 'Core::UDerived', kinds: ['function'], limit: 10 });
    assert.equal(mixin.data.matches[0]?.isMixin, true);
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
    assert.equal(publicConstructorQuery.data.total, 2);
    assert.equal(allConstructorQuery.data.total, 4);
    const selected = GetAPIExactSymbols({
        name: 'Core::FThing.FThing',
        kind: 'constructor',
        symbolId: constructors.data.symbols[1].symbolId,
    });
    assert.equal(selected.ok, true);
    assert.equal(GetAPIExactSymbols({ name: 'Core::FThing.FThing', symbolId: 'bad' }).ok, false);
    assert.equal(GetAPIExactSymbols({ name: 'Core::UDerived.UDerived', kind: 'constructor', includeNonPublic: true }).ok, false);
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
    assert.equal(publicConstructors.ok, true);
    assert.equal(allConstructors.ok, true);
    if (publicConstructors.ok && allConstructors.ok)
    {
        assert.equal(publicConstructors.data.groups[0].members.total, 2);
        assert.equal(allConstructors.data.groups[0].members.total, 4);
        assert.ok(allConstructors.data.groups[0].members.items.some((member) => member.visibility === 'private'));
        assert.ok(allConstructors.data.groups[0].members.items.some((member) => member.visibility === 'protected'));
    }
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
