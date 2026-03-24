import * as assert from 'node:assert/strict';
import test = require('node:test');
import {
    DBArg,
    DBMethod,
    DBNamespace,
    DBNamespaceDeclaration,
    DBProperty,
    DBType,
    AddTypeToDatabase,
    GetRootNamespace,
    OnDirtyTypeCaches,
    ResetDatabaseForTests
} from '../database';
import { GetAPISearch, InvalidateAPISearchCache } from '../api_search';

function declareNamespace(qualifiedName: string, declaredModule?: string): DBNamespace
{
    let current = GetRootNamespace();
    if (!qualifiedName)
        return current;

    for (const part of qualifiedName.split('::'))
    {
        let next = current.findChildNamespace(part);
        if (!next)
        {
            next = new DBNamespace();
            next.name = part;
            const declaration = new DBNamespaceDeclaration();
            declaration.declaredModule = declaredModule ?? null;
            next.addScriptDeclaration(declaration);
            current.addChildNamespace(next);
        }
        current = next;
    }

    return current;
}

function createMethod(
    name: string,
    returnType: string,
    declaredModule: string | null,
    args: Array<{ typename: string; name: string }> = [],
    documentation?: string
): DBMethod
{
    const method = new DBMethod();
    method.name = name;
    method.returnType = returnType;
    method.declaredModule = declaredModule;
    method.documentation = documentation ?? null;
    method.args = args.map((arg) => new DBArg().init(arg.typename, arg.name));
    return method;
}

function createMixinMethod(
    name: string,
    returnType: string,
    targetType: string,
    declaredModule: string | null,
    args: Array<{ typename: string; name: string }> = [],
    documentation?: string
): DBMethod
{
    const method = createMethod(
        name,
        returnType,
        declaredModule,
        [{ typename: targetType, name: 'Target' }, ...args],
        documentation
    );
    method.isMixin = true;
    return method;
}

function createProperty(name: string, typename: string, declaredModule: string | null, documentation?: string): DBProperty
{
    const property = new DBProperty();
    property.name = name;
    property.typename = typename;
    property.declaredModule = declaredModule;
    property.documentation = documentation ?? null;
    return property;
}

function createType(
    namespace: DBNamespace,
    name: string,
    options?: {
        declaredModule?: string | null;
        supertype?: string;
        isStruct?: boolean;
        isEnum?: boolean;
        documentation?: string;
        methods?: DBMethod[];
        properties?: DBProperty[];
    }
): DBType
{
    const dbType = new DBType().initEmpty(name);
    dbType.namespace = namespace;
    dbType.declaredModule = options?.declaredModule ?? null;
    dbType.supertype = options?.supertype ?? null;
    dbType.isStruct = options?.isStruct === true;
    dbType.isEnum = options?.isEnum === true;
    dbType.documentation = options?.documentation ?? null;

    for (const method of options?.methods ?? [])
        dbType.addSymbol(method);
    for (const property of options?.properties ?? [])
        dbType.addSymbol(property);

    AddTypeToDatabase(namespace, dbType);
    return dbType;
}

function setupSearchFixture(): void
{
    ResetDatabaseForTests();
    InvalidateAPISearchCache();

    const gameplay = declareNamespace('Gameplay');
    gameplay.documentation = 'Gameplay root namespace.';

    const movement = declareNamespace('Gameplay::Movement', 'Game.Modules.Movement');
    movement.documentation = 'Movement APIs.';

    const tools = declareNamespace('Tools');
    tools.documentation = 'Debug tooling.';
    const toolsMovement = declareNamespace('Tools::Movement');
    toolsMovement.documentation = 'Alternate movement namespace.';

    const hiddenNs = declareNamespace('Gameplay::_Hidden', 'Game.Modules.Hidden');
    hiddenNs.documentation = 'Hidden APIs.';

    movement.addSymbol(createMethod(
        'BuildMovementPath',
        'void',
        'Game.Modules.Movement',
        [{ typename: 'FVector', name: 'Target' }],
        'Builds a movement path.'
    ));
    movement.addSymbol(createMixinMethod(
        'BoostMovement',
        'void',
        'UMovementBase',
        'Game.Modules.Movement',
        [{ typename: 'float', name: 'BoostAmount' }],
        'Boosts movement through a mixin.'
    ));
    movement.addSymbol(createProperty(
        'GlobalMovementSpeed',
        'float',
        null,
        'Global movement speed.'
    ));

    tools.addSymbol(createMethod(
        'MovementDebugger',
        'void',
        null,
        [],
        'Debug movement state.'
    ));
    toolsMovement.addSymbol(createMethod(
        'TraceMovement',
        'void',
        null,
        [],
        'Trace movement state.'
    ));

    createType(movement, 'UCameraMovementComponent', {
        documentation: 'Camera movement component.',
        methods: [
            createMethod('StartCameraMovement', 'void', 'Game.Modules.Movement', [], 'Starts camera movement.'),
            createMethod('ResetCameraMovement', 'void', null, [], 'Resets camera movement.')
        ]
    });

    createType(movement, 'UMovementBase', {
        documentation: 'Base movement type.',
        methods: [
            createMethod('TickMovement', 'void', null, [], 'Ticks base movement.'),
            createMethod('ResetMovement', 'void', null, [], 'Resets movement at the base class.')
        ],
        properties: [
            createProperty('MaxSpeed', 'float', null, 'Maximum movement speed.')
        ]
    });

    createType(movement, 'UMovementMid', {
        declaredModule: 'Game.Modules.Movement',
        supertype: 'UMovementBase',
        documentation: 'Intermediate movement type.',
        methods: [
            createMethod('ResetMovement', 'void', 'Game.Modules.Movement', [], 'Resets movement in the mid class.')
        ]
    });

    createType(movement, 'UMovementDerived', {
        declaredModule: 'Game.Modules.Movement',
        supertype: 'UMovementMid',
        documentation: 'Derived movement type.',
        methods: [
            createMethod('StartMovement', 'void', 'Game.Modules.Movement', [], 'Starts movement.')
        ]
    });

    movement.addSymbol(createMixinMethod(
        'ApplyDerivedMovement',
        'void',
        'UMovementDerived',
        'Game.Modules.Movement',
        [{ typename: 'float', name: 'Scale' }],
        'Applies derived movement through a mixin.'
    ));

    createType(movement, 'EMovementState', {
        declaredModule: 'Game.Modules.Movement',
        isEnum: true,
        documentation: 'Movement state enum.'
    });

    createType(hiddenNs, '_HiddenMovementHelper', {
        declaredModule: 'Game.Modules.Hidden',
        documentation: 'Hidden movement helper.'
    });

    OnDirtyTypeCaches();
    InvalidateAPISearchCache();
}

test.beforeEach(() =>
{
    setupSearchFixture();
});

test('smart, exact, and regex search modes follow the new name-only contract', () =>
{
    const smart = GetAPISearch({ query: 'Camera Movement', mode: 'smart', limit: 10 });
    assert.ok(smart.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UCameraMovementComponent'));

    const exact = GetAPISearch({ query: 'Gameplay::Movement::UCameraMovementComponent', mode: 'exact', limit: 10 });
    assert.deepEqual(exact.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::UCameraMovementComponent']);

    const regex = GetAPISearch({ query: '/StartMovement$/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(regex.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::UMovementDerived.StartMovement']);

    const regexMixinAlias = GetAPISearch({ query: '/UMovementDerived\\.ApplyDerivedMovement$/', mode: 'regex', kinds: ['function'], limit: 10 });
    assert.deepEqual(regexMixinAlias.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::ApplyDerivedMovement']);
    assert.equal(regexMixinAlias.matches[0].isMixin, true);

    const regexDoesNotMatchSignature = GetAPISearch({ query: '/^void /', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.equal(regexDoesNotMatchSignature.matches.length, 0);
});

test('smart search supports compact queries, reversed-token fallback, and tiny-query suppression', () =>
{
    const compact = GetAPISearch({ query: 'CameraMovementComponent', mode: 'smart', limit: 10 });
    assert.ok(compact.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UCameraMovementComponent'));

    const reversed = GetAPISearch({ query: 'Movement Camera', mode: 'smart', kinds: ['class'], limit: 10 });
    assert.deepEqual(reversed.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::UCameraMovementComponent']);

    const mixinAlias = GetAPISearch({ query: 'UMovementDerived ApplyDerivedMovement', mode: 'smart', kinds: ['function'], limit: 10 });
    assert.deepEqual(mixinAlias.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::ApplyDerivedMovement']);
    assert.equal(mixinAlias.matches[0].isMixin, true);

    const tiny = GetAPISearch({ query: 'U', mode: 'smart', limit: 10 });
    assert.equal(tiny.matches.length, 0);
    assert.equal(tiny.notices?.[0]?.code, 'QUERY_TOO_SHORT');
});

test('source and kind filters narrow the search result set', () =>
{
    const filtered = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        kinds: ['method', 'function'],
        source: 'script',
        limit: 20
    });

    assert.ok(filtered.matches.every((match) => match.kind === 'method' || match.kind === 'function'));
    assert.ok(filtered.matches.every((match) => match.source === 'script'));
    assert.ok(filtered.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::BuildMovementPath'));
    assert.ok(filtered.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UMovementDerived.StartMovement'));
    assert.ok(filtered.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::ApplyDerivedMovement' && match.isMixin === true));
    assert.ok(!filtered.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UMovementBase.TickMovement'));
});

test('namespace scope restricts results to declared descendants', () =>
{
    const scoped = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement',
        limit: 20
    });

    assert.ok(scoped.matches.every((match) => match.qualifiedName.startsWith('Gameplay::Movement')));
    assert.ok(scoped.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::GlobalMovementSpeed'));
    assert.ok(!scoped.matches.some((match) => match.qualifiedName.startsWith('Tools::')));
    assert.ok(scoped.matches.every((match) => match.scopeRelationship === 'declared'));
    assert.ok(!scoped.matches.some((match) => match.qualifiedName === 'Gameplay::Movement'));
    assert.equal(scoped.inheritedScopeOutcome, undefined);
});

test('class scope can expand inherited members and dedupe overridden ancestors', () =>
{
    const scoped = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement::UMovementDerived',
        kinds: ['method', 'property'],
        includeInheritedFromScope: true,
        limit: 20
    });

    assert.ok(scoped.matches.some((match) =>
        match.qualifiedName === 'Gameplay::Movement::UMovementDerived.StartMovement'
        && match.scopeRelationship === 'declared'
        && match.scopeDistance === 0
    ));
    assert.ok(scoped.matches.some((match) =>
        match.qualifiedName === 'Gameplay::Movement::UMovementBase.TickMovement'
        && match.scopeRelationship === 'inherited'
        && match.scopeDistance === 2
    ));
    assert.ok(scoped.matches.some((match) =>
        match.qualifiedName === 'Gameplay::Movement::UMovementBase.MaxSpeed'
        && match.scopeRelationship === 'inherited'
        && match.scopeDistance === 2
    ));
    assert.equal(scoped.inheritedScopeOutcome, 'applied');
});

test('type scope includes applicable mixin functions and preserves function kind', () =>
{
    const scoped = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement::UMovementDerived',
        kinds: ['function'],
        includeInheritedFromScope: true,
        limit: 20
    });

    assert.ok(scoped.matches.some((match) =>
        match.qualifiedName === 'Gameplay::Movement::ApplyDerivedMovement'
        && match.kind === 'function'
        && match.isMixin === true
        && match.scopeRelationship === 'mixin'
        && match.scopeDistance === 0
    ));
    assert.ok(scoped.matches.some((match) =>
        match.qualifiedName === 'Gameplay::Movement::BoostMovement'
        && match.kind === 'function'
        && match.isMixin === true
        && match.scopeRelationship === 'mixin'
        && match.scopeDistance === 2
    ));
});

test('invalid scope lookup returns notices without throwing', () =>
{
    const missingScopePrefix = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(missingScopePrefix.inheritedScopeOutcome, 'ignored_missing_scope_prefix');
    assert.equal(missingScopePrefix.scopeLookup, undefined);

    const missing = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Missing',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(missing.matches.length, 0);
    assert.equal(missing.inheritedScopeOutcome, 'ignored_scope_not_found');
    assert.equal(missing.notices, undefined);
    assert.deepEqual(missing.scopeLookup, {
        requestedPrefix: 'Gameplay::Missing'
    });

    const ambiguous = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Movement',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(ambiguous.matches.length, 0);
    assert.equal(ambiguous.inheritedScopeOutcome, 'ignored_scope_ambiguous');
    assert.deepEqual(ambiguous.scopeLookup?.ambiguousCandidates, ['Gameplay::Movement', 'Tools::Movement']);
    assert.equal(ambiguous.notices, undefined);

    const namespaceScope = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(namespaceScope.inheritedScopeOutcome, 'ignored_scope_not_class');
    assert.equal(namespaceScope.scopeLookup?.resolvedKind, 'namespace');
    assert.ok(namespaceScope.matches.length > 0);
    assert.equal(namespaceScope.notices, undefined);

    const nonClass = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement::EMovementState',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(nonClass.scopeLookup?.resolvedKind, 'enum');
    assert.equal(nonClass.inheritedScopeOutcome, 'ignored_scope_not_class');
    assert.equal(nonClass.notices, undefined);
});

test('applied inheritedScopeOutcome does not suppress empty inheritance notice', () =>
{
    const scoped = GetAPISearch({
        query: 'CameraMovement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement::UCameraMovementComponent',
        kinds: ['method'],
        includeInheritedFromScope: true,
        limit: 20
    });

    assert.equal(scoped.inheritedScopeOutcome, 'applied');
    assert.ok(scoped.notices?.some((notice) => notice.code === 'SCOPE_INHERITANCE_EMPTY'));
});

test('nearest override wins when inherited members share the same override key', () =>
{
    const scoped = GetAPISearch({
        query: 'ResetMovement',
        mode: 'smart',
        scopePrefix: 'Gameplay::Movement::UMovementDerived',
        kinds: ['method'],
        includeInheritedFromScope: true,
        limit: 20
    });

    assert.deepEqual(
        scoped.matches.map((match) => match.qualifiedName),
        ['Gameplay::Movement::UMovementMid.ResetMovement']
    );
    assert.equal(scoped.matches[0].scopeRelationship, 'inherited');
    assert.equal(scoped.matches[0].scopeDistance, 1);
});

test('internal symbols are returned without a dedicated visibility flag', () =>
{
    const hiddenMatches = GetAPISearch({
        query: 'HiddenMovement',
        mode: 'smart',
        limit: 10
    });
    assert.deepEqual(hiddenMatches.matches.map((match) => match.qualifiedName), ['Gameplay::_Hidden::_HiddenMovementHelper']);
});

test('namespace is no longer an accepted public kind filter', () =>
{
    assert.throws(
        () => GetAPISearch({ query: 'Movement', mode: 'smart', kinds: ['namespace'], limit: 10 }),
        /Unsupported kind "namespace"/u
    );
});
