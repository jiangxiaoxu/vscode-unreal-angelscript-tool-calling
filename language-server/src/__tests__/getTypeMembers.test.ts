import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import test = require('node:test');
import { pathToFileURL } from 'node:url';
import * as scriptfiles from '../as_parser';
import {
    DBArg,
    DBMethod,
    DBNamespace,
    DBNamespaceDeclaration,
    DBProperty,
    DBType,
    AddPrimitiveTypes,
    AddTypeToDatabase,
    GetRootNamespace,
    OnDirtyTypeCaches,
    ResetDatabaseForTests
} from '../database';
import { GetTypeMembers } from '../api_docs';

let moduleCounter = 0;

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
    dbType.documentation = options?.documentation ?? null;

    for (const method of options?.methods ?? [])
        dbType.addSymbol(method);
    for (const property of options?.properties ?? [])
        dbType.addSymbol(property);

    AddTypeToDatabase(namespace, dbType);
    return dbType;
}

function createResolvedTypeMembersModule(content: string): scriptfiles.ASModule
{
    ResetDatabaseForTests();
    scriptfiles.ClearAllResolvedModules();
    AddPrimitiveTypes(scriptfiles.GetScriptSettings().floatIsFloat64);
    OnDirtyTypeCaches();

    moduleCounter += 1;
    const filePath = path.join(os.tmpdir(), `get-type-members-${moduleCounter}.as`);
    const uri = pathToFileURL(filePath).toString();
    const moduleName = `Get.TypeMembers.${moduleCounter}`;
    const asmodule = scriptfiles.GetOrCreateModule(moduleName, filePath, uri);
    scriptfiles.UpdateModuleFromContent(asmodule, content);
    scriptfiles.ParseModuleAndDependencies(asmodule);
    scriptfiles.PostProcessModuleTypesAndDependencies(asmodule);
    scriptfiles.ResolveModule(asmodule);
    return asmodule;
}

function setupTypeMembersFixture(): void
{
    ResetDatabaseForTests();

    const movement = declareNamespace('Gameplay::Movement', 'Game.Modules.Movement');

    createType(movement, 'UMovementBase', {
        declaredModule: 'Game.Modules.Movement',
        documentation: 'Base movement type.',
        methods: [
            createMethod('TickMovement', 'void', 'Game.Modules.Movement', [], 'Ticks base movement.')
        ],
        properties: [
            createProperty('MaxSpeed', 'float', 'Game.Modules.Movement', 'Maximum movement speed.')
        ]
    });

    createType(movement, 'UMovementDerived', {
        declaredModule: 'Game.Modules.Movement',
        supertype: 'UMovementBase',
        documentation: 'Derived movement type.',
        methods: [
            createMethod('StartMovement', 'void', 'Game.Modules.Movement', [], 'Starts movement.')
        ]
    });

    createType(movement, 'UEmptyMovementShell', {
        declaredModule: 'Game.Modules.Movement',
        supertype: 'UMovementBase',
        documentation: 'Empty movement shell.'
    });

    createType(movement, 'UUndocumentedMovement', {
        declaredModule: 'Game.Modules.Movement',
        methods: [
            createMethod('StopMovement', 'void', 'Game.Modules.Movement', [], 'Stops movement.')
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

    OnDirtyTypeCaches();
}

test.beforeEach(() =>
{
    setupTypeMembersFixture();
});

test('GetTypeMembers always returns the target type description while gating member docs behind includeDocs=false', () =>
{
    const result = GetTypeMembers({
        name: 'UMovementDerived',
        namespace: 'Gameplay::Movement',
        includeInherited: true,
        includeDocs: false
    });

    assert.equal(result.ok, true);
    if (result.ok !== true)
        return;

    assert.equal(result.type.description, 'Derived movement type.');
    assert.ok(result.members.some((member) => member.name === 'StartMovement'));
    assert.ok(result.members.some((member) => member.name === 'TickMovement'));
    assert.ok(result.members.some((member) => member.name === 'MaxSpeed'));
    assert.ok(result.members.some((member) => member.name === 'ApplyDerivedMovement' && member.isMixin === true));
    assert.ok(result.members.every((member) => member.description === ''));
});

test('GetTypeMembers includes member descriptions when includeDocs=true', () =>
{
    const result = GetTypeMembers({
        name: 'UMovementDerived',
        namespace: 'Gameplay::Movement',
        includeInherited: true,
        includeDocs: true
    });

    assert.equal(result.ok, true);
    if (result.ok !== true)
        return;

    assert.equal(result.type.description, 'Derived movement type.');
    assert.equal(result.members.find((member) => member.name === 'StartMovement')?.description, 'Starts movement.');
    assert.equal(result.members.find((member) => member.name === 'MaxSpeed')?.description, 'Maximum movement speed.');
    assert.equal(
        result.members.find((member) => member.name === 'ApplyDerivedMovement')?.description,
        'Applies derived movement through a mixin.'
    );
});

test('GetTypeMembers returns an empty target type description when the type is undocumented', () =>
{
    const result = GetTypeMembers({
        name: 'UUndocumentedMovement',
        namespace: 'Gameplay::Movement',
        includeDocs: false
    });

    assert.equal(result.ok, true);
    if (result.ok !== true)
        return;

    assert.equal(result.type.description, '');
});

test('GetTypeMembers keeps direct members empty for an empty class while inherited expansion remains opt-in', () =>
{
    const directOnly = GetTypeMembers({
        name: 'UEmptyMovementShell',
        namespace: 'Gameplay::Movement',
        includeInherited: false,
        includeDocs: false
    });

    assert.equal(directOnly.ok, true);
    if (directOnly.ok !== true)
        return;

    assert.equal(directOnly.type.description, 'Empty movement shell.');
    assert.deepEqual(directOnly.members.map((member) => member.name), []);

    const withInherited = GetTypeMembers({
        name: 'UEmptyMovementShell',
        namespace: 'Gameplay::Movement',
        includeInherited: true,
        includeDocs: false
    });

    assert.equal(withInherited.ok, true);
    if (withInherited.ok !== true)
        return;

    assert.ok(withInherited.members.some((member) => member.name === 'TickMovement' && member.isInherited === true));
    assert.ok(withInherited.members.some((member) => member.name === 'MaxSpeed' && member.isInherited === true));
});

test('GetTypeMembers ignores commented-out code lines collected as script documentation', () =>
{
    createResolvedTypeMembersModule([
        'class UDocNoiseFixture',
        '{',
        '    // default MontageSlotName = n"OverrideFullBody";',
        '    void ActivateAbility() {}',
        '}',
    ].join('\n'));

    const result = GetTypeMembers({
        name: 'UDocNoiseFixture',
        includeInherited: false,
        includeDocs: true,
        kinds: 'method'
    });

    assert.equal(result.ok, true);
    if (result.ok !== true)
        return;

    assert.equal(result.members.length, 1);
    assert.equal(result.members[0].name, 'ActivateAbility');
    assert.equal(result.members[0].description, '');
});
