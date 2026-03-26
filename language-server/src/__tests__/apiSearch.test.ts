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
    const characters = declareNamespace('Gameplay::Characters', 'Game.Modules.Characters');
    characters.documentation = 'Character APIs.';

    const tools = declareNamespace('Tools');
    tools.documentation = 'Debug tooling.';
    const toolsMovement = declareNamespace('Tools::Movement');
    toolsMovement.documentation = 'Alternate movement namespace.';
    const gameplayTags = declareNamespace('GameplayTags');
    gameplayTags.documentation = 'Gameplay tag constants.';

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
    gameplayTags.addSymbol(createProperty(
        'Status_AI',
        'FGameplayTag',
        null,
        'AI gameplay tag.'
    ));
    gameplayTags.addSymbol(createProperty(
        'Status_Player',
        'FGameplayTag',
        null,
        'Player gameplay tag.'
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

    const cthuAccessor = createMethod(
        'GetCthuASC',
        'UCthuAbilitySystemComponent',
        'Game.Modules.Characters',
        [],
        'A property-like accessor imported as a method.'
    );
    cthuAccessor.isProperty = true;

    const openEditorOnlyPanel = createMethod(
        'OpenEditorOnlyPanel',
        'void',
        'Game.Modules.Characters',
        [],
        'A method that should not be treated as callable by search.'
    );
    openEditorOnlyPanel.isCallable = false;

    createType(characters, 'UCthuAICharacterExtension', {
        declaredModule: 'Game.Modules.Characters',
        documentation: 'Character extension helpers.',
        methods: [
            createMethod(
                'OpenPawnDataAIAsset',
                'void',
                'Game.Modules.Characters',
                [{ typename: 'AActor', name: 'SelectedActor' }],
                'Opens the selected pawn data asset.'
            )
        ],
        properties: [
            createProperty(
                'OpenPawnDataAIAsset',
                'UDataAsset',
                'Game.Modules.Characters',
                'A same-name property used to verify callable-only filtering.'
            )
        ]
    });

    createType(characters, 'UOpenPawnDataAIAsset', {
        declaredModule: 'Game.Modules.Characters',
        documentation: 'A same-name type used to verify callable-only filtering.'
    });

    createType(characters, 'UCthuAbilityTask_Ticker', {
        declaredModule: 'Game.Modules.Characters',
        documentation: 'Accessor regression fixture.',
        methods: [
            cthuAccessor,
            openEditorOnlyPanel
        ]
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

test('plain, smart, and regex search modes follow the new name-view contract', () =>
{
    const plainExactQualified = GetAPISearch({ query: 'Gameplay::Movement::UCameraMovementComponent', mode: 'plain', limit: 10 });
    assert.equal(plainExactQualified.matches[0]?.qualifiedName, 'Gameplay::Movement::UCameraMovementComponent');
    assert.equal(plainExactQualified.matches[0]?.matchReason, 'exact-qualified');

    const plainCallableQualified = GetAPISearch({
        query: 'Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset(',
        mode: 'plain',
        limit: 10
    });
    assert.deepEqual(plainCallableQualified.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(plainCallableQualified.matches[0]?.kind, 'method');

    const smart = GetAPISearch({ query: 'Camera Movement', mode: 'smart', limit: 10 });
    assert.ok(smart.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UCameraMovementComponent'));
    const smartExactQualified = GetAPISearch({ query: 'Gameplay::Movement::UCameraMovementComponent', mode: 'smart', limit: 10 });
    assert.deepEqual(smartExactQualified.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::UCameraMovementComponent']);
    assert.equal(smartExactQualified.matches[0]?.matchReason, 'exact-qualified');

    const regex = GetAPISearch({ query: '/StartMovement$/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(regex.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::UMovementDerived.StartMovement']);

    const regexOr = GetAPISearch({ query: '/StartMovement$|TickMovement$/', mode: 'regex', kinds: ['method'], limit: 20 });
    assert.deepEqual([...regexOr.matches.map((match) => match.qualifiedName)].sort(), [
        'Gameplay::Movement::UMovementDerived.StartMovement',
        'Gameplay::Movement::UMovementBase.TickMovement'
    ].sort());

    const regexMixinAlias = GetAPISearch({ query: '/UMovementDerived\\.ApplyDerivedMovement$/', mode: 'regex', kinds: ['function'], limit: 10 });
    assert.deepEqual(regexMixinAlias.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::ApplyDerivedMovement']);
    assert.equal(regexMixinAlias.matches[0].isMixin, true);

    const regexCallableMethod = GetAPISearch({ query: '/UCthuAICharacterExtension\\.OpenPawnDataAIAsset\\(/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(regexCallableMethod.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);

    const regexCallableFunction = GetAPISearch({ query: '/Gameplay::Movement::BuildMovementPath\\(/', mode: 'regex', kinds: ['function'], limit: 10 });
    assert.deepEqual(regexCallableFunction.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::BuildMovementPath']);

    const regexDoesNotMatchSignature = GetAPISearch({ query: '/^void /', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.equal(regexDoesNotMatchSignature.matches.length, 0);
});

test('plain search supports code-like queries, ordered gaps, weak reorder fallback, and callable-only suffixes', () =>
{
    const codeLikeMember = GetAPISearch({ query: 'UCthuAICharacterExtension.OpenPawnDataAIAsset(', mode: 'plain', limit: 10 });
    assert.deepEqual(codeLikeMember.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(codeLikeMember.matches[0]?.matchReason, 'boundary-ordered');

    const namespaceFunction = GetAPISearch({ query: 'Gameplay::Movement::BuildMovementPath(', mode: 'plain', limit: 10 });
    assert.deepEqual(namespaceFunction.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::BuildMovementPath']);
    assert.equal(namespaceFunction.matches[0]?.kind, 'function');

    const orderedGap = GetAPISearch({ query: 'Status AI', mode: 'plain', limit: 10 });
    assert.deepEqual(orderedGap.matches.map((match) => match.qualifiedName), ['GameplayTags::Status_AI']);
    assert.equal(orderedGap.matches[0]?.matchReason, 'ordered-wildcard');

    const weakReorder = GetAPISearch({ query: 'AI Status', mode: 'plain', limit: 10 });
    assert.equal(weakReorder.matches[0]?.qualifiedName, 'GameplayTags::Status_AI');
    assert.equal(weakReorder.matches[0]?.matchReason, 'weak-reorder');

    const callableShort = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'plain', limit: 10 });
    assert.deepEqual(callableShort.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);

    const callableShortWithParens = GetAPISearch({ query: 'OpenPawnDataAIAsset()', mode: 'plain', limit: 10 });
    assert.deepEqual(callableShortWithParens.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
});

test('callable-only excludes property-like accessors and non-callable methods across search modes', () =>
{
    const accessorPlain = GetAPISearch({ query: 'GetCthuASC', mode: 'plain', limit: 10 });
    assert.deepEqual(accessorPlain.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAbilityTask_Ticker.GetCthuASC']);

    const accessorPlainCallable = GetAPISearch({ query: 'GetCthuASC()', mode: 'plain', limit: 10 });
    assert.equal(accessorPlainCallable.matches.length, 0);

    const accessorSmartCallable = GetAPISearch({ query: 'GetCthuASC()', mode: 'smart', limit: 10 });
    assert.equal(accessorSmartCallable.matches.length, 0);

    const accessorRegex = GetAPISearch({ query: '/GetCthuASC$/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.deepEqual(accessorRegex.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAbilityTask_Ticker.GetCthuASC']);

    const accessorRegexCallable = GetAPISearch({ query: '/GetCthuASC\\(/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.equal(accessorRegexCallable.matches.length, 0);

    const nonCallablePlain = GetAPISearch({ query: 'OpenEditorOnlyPanel', mode: 'plain', limit: 10 });
    assert.deepEqual(nonCallablePlain.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAbilityTask_Ticker.OpenEditorOnlyPanel']);

    const nonCallablePlainCallable = GetAPISearch({ query: 'OpenEditorOnlyPanel()', mode: 'plain', limit: 10 });
    assert.equal(nonCallablePlainCallable.matches.length, 0);

    const nonCallableSmartCallable = GetAPISearch({ query: 'OpenEditorOnlyPanel()', mode: 'smart', limit: 10 });
    assert.equal(nonCallableSmartCallable.matches.length, 0);

    const nonCallableRegexCallable = GetAPISearch({ query: '/OpenEditorOnlyPanel\\(/', mode: 'regex', kinds: ['method'], limit: 10 });
    assert.equal(nonCallableRegexCallable.matches.length, 0);
});

test('smart search uses ordered wildcard matching with strict separators', () =>
{
    const compact = GetAPISearch({ query: 'CameraMovementComponent', mode: 'smart', limit: 10 });
    assert.ok(compact.matches.some((match) => match.qualifiedName === 'Gameplay::Movement::UCameraMovementComponent'));
    assert.equal(compact.matches[0]?.matchReason, 'ordered-wildcard');

    const qualifiedPrefix = GetAPISearch({ query: 'gameplayt', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(qualifiedPrefix.matches.map((match) => match.qualifiedName), [
        'GameplayTags::Status_AI',
        'GameplayTags::Status_Player'
    ]);
    assert.equal(qualifiedPrefix.matches[0]?.matchReason, 'ordered-wildcard');

    const qualifiedLongerPrefix = GetAPISearch({ query: 'gameplayta', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(qualifiedLongerPrefix.matches.map((match) => match.qualifiedName), [
        'GameplayTags::Status_AI',
        'GameplayTags::Status_Player'
    ]);
    assert.equal(qualifiedLongerPrefix.matches[0]?.matchReason, 'ordered-wildcard');

    const mixinAlias = GetAPISearch({ query: 'UMovementDerived ApplyDerivedMovement', mode: 'smart', kinds: ['function'], limit: 10 });
    assert.deepEqual(mixinAlias.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::ApplyDerivedMovement']);
    assert.equal(mixinAlias.matches[0].isMixin, true);
    assert.equal(mixinAlias.matches[0].matchReason, 'ordered-wildcard');

    const wildcardGap = GetAPISearch({ query: 'gameplayt AI', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(wildcardGap.matches.map((match) => match.qualifiedName), ['GameplayTags::Status_AI']);
    assert.equal(wildcardGap.matches[0]?.matchReason, 'ordered-wildcard');

    const namespaceBoundary = GetAPISearch({ query: 'gameplayt :: AI', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(namespaceBoundary.matches.map((match) => match.qualifiedName), ['GameplayTags::Status_AI']);
    assert.equal(namespaceBoundary.matches[0]?.matchReason, 'boundary-ordered');

    const splitNamespaceBoundary = GetAPISearch({ query: 'play tag :: AI', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(splitNamespaceBoundary.matches.map((match) => match.qualifiedName), ['GameplayTags::Status_AI']);
    assert.equal(splitNamespaceBoundary.matches[0]?.matchReason, 'boundary-ordered');

    const strictMemberBoundary = GetAPISearch({ query: 'gameplayt . AI', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.equal(strictMemberBoundary.matches.length, 0);

    const orderedMemberBoundary = GetAPISearch({ query: 'movement . start', mode: 'smart', kinds: ['method'], limit: 20 });
    assert.ok(orderedMemberBoundary.matches.length > 0);
    assert.ok(orderedMemberBoundary.matches.every((match) => match.qualifiedName.includes('.')));
    assert.ok(orderedMemberBoundary.matches.every((match) => match.matchReason === 'boundary-ordered'));

    const suffixWildcard = GetAPISearch({ query: 'status AI', mode: 'smart', kinds: ['globalVariable'], limit: 10 });
    assert.deepEqual(suffixWildcard.matches.map((match) => match.qualifiedName), ['GameplayTags::Status_AI']);
    assert.equal(suffixWildcard.matches[0]?.matchReason, 'ordered-wildcard');

    const smartOr = GetAPISearch({ query: 'GameplayTags :: AI | Status Player', mode: 'smart', limit: 20 });
    assert.deepEqual(smartOr.matches.map((match) => match.qualifiedName), [
        'GameplayTags::Status_AI',
        'GameplayTags::Status_Player'
    ]);

    const smartOrDeduped = GetAPISearch({ query: 'OpenPawnDataAIAsset( | Cthu Extension DataAIAsset(', mode: 'smart', limit: 20 });
    assert.deepEqual(smartOrDeduped.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);

    const smartOrMixedTiny = GetAPISearch({ query: 'U | OpenPawnDataAIAsset(', mode: 'smart', limit: 20 });
    assert.deepEqual(smartOrMixedTiny.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(smartOrMixedTiny.notices, undefined);

    const callableShort = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', limit: 10 });
    assert.deepEqual(callableShort.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(callableShort.matches[0]?.kind, 'method');

    const callableShortWithParens = GetAPISearch({ query: 'OpenPawnDataAIAsset()', mode: 'smart', limit: 10 });
    assert.deepEqual(callableShortWithParens.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(callableShortWithParens.matches[0]?.kind, 'method');

    const callableMemberBoundary = GetAPISearch({ query: 'Cthu Extension . DataAIAsset(', mode: 'smart', limit: 10 });
    assert.deepEqual(callableMemberBoundary.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(callableMemberBoundary.matches[0]?.matchReason, 'boundary-ordered');

    const callableWildcard = GetAPISearch({ query: 'Cthu Extension DataAIAsset(', mode: 'smart', limit: 10 });
    assert.deepEqual(callableWildcard.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(callableWildcard.matches[0]?.matchReason, 'ordered-wildcard');

    const callableMethodsOnly = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', kinds: ['method'], limit: 10 });
    assert.deepEqual(callableMethodsOnly.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset']);
    assert.equal(callableMethodsOnly.matches[0]?.kind, 'method');

    const callableFunctionsOnly = GetAPISearch({ query: 'BuildMovementPath(', mode: 'smart', kinds: ['function'], limit: 10 });
    assert.deepEqual(callableFunctionsOnly.matches.map((match) => match.qualifiedName), ['Gameplay::Movement::BuildMovementPath']);
    assert.equal(callableFunctionsOnly.matches[0]?.kind, 'function');

    const callablePropertiesOnly = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', kinds: ['property'], limit: 10 });
    assert.equal(callablePropertiesOnly.matches.length, 0);

    const tiny = GetAPISearch({ query: 'U', mode: 'smart', limit: 10 });
    assert.equal(tiny.matches.length, 0);
    assert.equal(tiny.notices?.[0]?.code, 'QUERY_TOO_SHORT');

    const allTinyOr = GetAPISearch({ query: 'U | A', mode: 'smart', limit: 10 });
    assert.equal(allTinyOr.matches.length, 0);
    assert.equal(allTinyOr.notices?.[0]?.code, 'QUERY_TOO_SHORT');
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

test('common smart searches do not require kind filters', () =>
{
    const typeSearch = GetAPISearch({ query: 'CameraMovementComponent', mode: 'smart', limit: 10 });
    assert.equal(typeSearch.matches[0]?.qualifiedName, 'Gameplay::Movement::UCameraMovementComponent');
    assert.equal(typeSearch.matches[0]?.kind, 'class');

    const callableSearch = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', limit: 10 });
    assert.equal(callableSearch.matches[0]?.qualifiedName, 'Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset');
    assert.equal(callableSearch.matches[0]?.kind, 'method');

    const globalSearch = GetAPISearch({ query: 'status AI', mode: 'smart', limit: 10 });
    assert.equal(globalSearch.matches[0]?.qualifiedName, 'GameplayTags::Status_AI');
    assert.equal(globalSearch.matches[0]?.kind, 'globalVariable');
});

test('includeDocs enriches search results without changing ordering', () =>
{
    const withoutDocs = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', limit: 10 });
    const withDocs = GetAPISearch({ query: 'OpenPawnDataAIAsset(', mode: 'smart', limit: 10, includeDocs: true });

    assert.equal(withoutDocs.matches[0]?.qualifiedName, withDocs.matches[0]?.qualifiedName);
    assert.equal(withoutDocs.matches[0]?.documentation, undefined);
    assert.equal(withDocs.matches[0]?.documentation, 'Opens the selected pawn data asset.');
    assert.equal(withDocs.matches[0]?.summary, 'Opens the selected pawn data asset.');
});

test('namespace scope restricts results to declared descendants', () =>
{
    const scoped = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scope: 'Gameplay::Movement',
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
        scope: 'Gameplay::Movement::UMovementDerived',
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
        scope: 'Gameplay::Movement::UMovementDerived',
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

    assert.equal(missingScopePrefix.inheritedScopeOutcome, 'ignored_missing_scope');
    assert.equal(missingScopePrefix.scopeLookup, undefined);

    const missing = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scope: 'Gameplay::Missing',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(missing.matches.length, 0);
    assert.equal(missing.inheritedScopeOutcome, 'ignored_scope_not_found');
    assert.equal(missing.notices, undefined);
    assert.deepEqual(missing.scopeLookup, {
        requestedScope: 'Gameplay::Missing'
    });

    const ambiguous = GetAPISearch({
        query: 'Movement',
        mode: 'smart',
        scope: 'Movement',
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
        scope: 'Gameplay::Movement',
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
        scope: 'Gameplay::Movement::EMovementState',
        includeInheritedFromScope: true,
        limit: 10
    });

    assert.equal(nonClass.scopeLookup?.resolvedKind, 'enum');
    assert.equal(nonClass.inheritedScopeOutcome, 'ignored_scope_not_class');
    assert.equal(nonClass.notices, undefined);
});

test('scope lookup dedupes identical qualified-name candidates before ambiguity checks', () =>
{
    createType(declareNamespace('Gameplay::Characters', 'Game.Modules.Characters'), 'UCthuBattleSet', {
        declaredModule: 'Game.Modules.Characters',
        methods: [
            createMethod('GetOwnedGameplayTags', 'void', 'Game.Modules.Characters', [], 'Regression scope hit.')
        ]
    });
    createType(declareNamespace('Gameplay::Characters', 'Game.Modules.Characters'), 'UCthuBattleSet', {
        declaredModule: 'Game.Modules.Characters',
        documentation: 'Duplicate scope candidate.'
    });

    OnDirtyTypeCaches();
    InvalidateAPISearchCache();

    const scoped = GetAPISearch({
        query: 'GetOwnedGameplayTags',
        mode: 'plain',
        scope: 'Gameplay::Characters::UCthuBattleSet',
        limit: 20
    });

    assert.deepEqual(scoped.matches.map((match) => match.qualifiedName), ['Gameplay::Characters::UCthuBattleSet.GetOwnedGameplayTags']);
    assert.deepEqual(scoped.scopeLookup, {
        requestedScope: 'Gameplay::Characters::UCthuBattleSet',
        resolvedQualifiedName: 'Gameplay::Characters::UCthuBattleSet',
        resolvedKind: 'class'
    });
    assert.equal(scoped.inheritedScopeOutcome, undefined);
});

test('scope collision auto-merges same-name namespace and class groups', () =>
{
    const collisionNamespace = declareNamespace('UCthuBattleSet', 'Game.Modules.Characters');
    collisionNamespace.addSymbol(createMethod(
        'GetManaAttr',
        'FGameplayAttribute',
        'Game.Modules.Characters',
        [],
        'Namespace accessor.'
    ));
    collisionNamespace.addSymbol(createMethod(
        'GetMaxManaAttr',
        'FGameplayAttribute',
        'Game.Modules.Characters',
        [],
        'Namespace accessor.'
    ));

    createType(GetRootNamespace(), 'UCthuBattleSet', {
        declaredModule: 'Game.Modules.Characters',
        methods: [
            createMethod('GetOwnedGameplayTags', 'void', 'Game.Modules.Characters', [], 'Type member.')
        ]
    });

    OnDirtyTypeCaches();
    InvalidateAPISearchCache();

    const scoped = GetAPISearch({
        query: 'Get',
        mode: 'plain',
        scope: 'UCthuBattleSet',
        limit: 2
    });

    assert.deepEqual(scoped.matches.map((match) => match.qualifiedName), [
        'UCthuBattleSet.GetOwnedGameplayTags',
        'UCthuBattleSet::GetManaAttr'
    ]);
    assert.deepEqual(scoped.matchCounts, {
        total: 3,
        returned: 2,
        omitted: 1
    });
    assert.deepEqual(scoped.scopeLookup, {
        requestedScope: 'UCthuBattleSet',
        resolvedQualifiedName: 'UCthuBattleSet',
        resolvedKind: 'class'
    });
    assert.equal(scoped.scopeGroups?.length, 2);
    assert.deepEqual(scoped.scopeGroups?.[0].scope, {
        requestedScope: 'UCthuBattleSet',
        resolvedQualifiedName: 'UCthuBattleSet',
        resolvedKind: 'class'
    });
    assert.equal(scoped.scopeGroups?.[0].totalMatches, 1);
    assert.equal(scoped.scopeGroups?.[0].omittedMatches, 0);
    assert.deepEqual(
        scoped.scopeGroups?.[0].matches.map((match) => match.qualifiedName),
        ['UCthuBattleSet.GetOwnedGameplayTags']
    );
    assert.deepEqual(scoped.scopeGroups?.[1].scope, {
        requestedScope: 'UCthuBattleSet',
        resolvedQualifiedName: 'UCthuBattleSet',
        resolvedKind: 'namespace'
    });
    assert.equal(scoped.scopeGroups?.[1].totalMatches, 2);
    assert.equal(scoped.scopeGroups?.[1].omittedMatches, 1);
    assert.deepEqual(
        scoped.scopeGroups?.[1].matches.map((match) => match.qualifiedName),
        ['UCthuBattleSet::GetManaAttr']
    );
});

test('applied inheritedScopeOutcome does not suppress empty inheritance notice', () =>
{
    const scoped = GetAPISearch({
        query: 'CameraMovement',
        mode: 'smart',
        scope: 'Gameplay::Movement::UCameraMovementComponent',
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
        scope: 'Gameplay::Movement::UMovementDerived',
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

test('smart OR rejects empty branches and public exact mode is removed', () =>
{
    assert.throws(
        () => GetAPISearch({ query: 'Movement || Start', mode: 'smart', limit: 10 }),
        /empty smart OR branch/u
    );
    assert.throws(
        () => GetAPISearch({ query: 'StartMovement$', mode: 'regex', limit: 10 }),
        /Expected \/pattern\/flags syntax/u
    );
    assert.throws(
        () => GetAPISearch({ query: 'Movement', mode: 'exact', limit: 10 } as any),
        /'mode' must be 'smart', 'plain', or 'regex'/u
    );
});
