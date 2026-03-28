#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../language-server/src/__tests__/fixtures/apiSearch.realSymbols.fixture.json');
const CACHE_PATH_ENV = 'ANGELSCRIPT_REAL_CACHE_PATH';

const ENTRY_SPECS = [
    {
        bucket: 'gameplay',
        name: '__GameplayTags',
        keepProperties: [
            'GameplayCue',
            'GameplayCue_Test',
            'Settings_Movement',
            'FeatureName_AIPawnData',
            'Status',
            'Status_StunGauge'
        ]
    },
    {
        bucket: 'gameplay',
        name: '__AbilitySystem',
        keepMethods: [
            'AddGameplayTags',
            'BindEventWrapperToGameplayTagChanged',
            'DoesGameplayCueMeetTagRequirements'
        ]
    },
    {
        bucket: 'ai',
        name: '__AIHelper',
        keepMethods: [
            'GetAIController',
            'IsValidAILocation',
            'SpawnAIFromClass'
        ]
    },
    {
        bucket: 'camera',
        name: '__CameraPose',
        keepMethods: [
            'GetAimDir',
            'GetTransform',
            'MakeCameraPoseFromCameraComponent'
        ]
    },
    {
        bucket: 'camera',
        name: '__CameraVariableTable',
        keepMethods: [
            'GetFloatCameraVariable',
            'SetVector3CameraVariable'
        ]
    },
    {
        bucket: 'ai',
        name: '__EAILockSource',
        keepProperties: [
            'Animation',
            'Gameplay',
            'Logic'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'UAbilitySystemComponent',
        keepMethods: [
            'GetOwnedGameplayTags',
            'TryActivateAbilitiesByTag'
        ],
        keepProperties: [
            'AffectedAnimInstanceTag'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'UGameplayAbility',
        keepMethods: [
            'ApplyGameplayEffectToOwner',
            'GetAbilitySystemComponentFromActorInfo'
        ],
        keepProperties: [
            'AbilityTags'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'UGameplayEffect',
        keepMethods: [
            'GetGrantedTags',
            'GetOwnedGameplayTags'
        ],
        keepProperties: [
            'GameplayCues'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'UGameplayTask',
        keepMethods: [
            'EndTask',
            'ReadyForActivation'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'UGameplayTask_WaitDelay',
        keepProperties: [
            'OnFinish'
        ]
    },
    {
        bucket: 'ai',
        name: 'AAIController',
        keepMethods: [
            'GetAIPerceptionComponent',
            'MoveToActor'
        ],
        keepProperties: [
            'BrainComponent'
        ]
    },
    {
        bucket: 'movement',
        name: 'UMovementComponent',
        keepMethods: [
            'SetPlaneConstraintEnabled',
            'StopMovementImmediately'
        ],
        keepProperties: [
            'bConstrainToPlane'
        ]
    },
    {
        bucket: 'movement',
        name: 'UCharacterMovementComponent',
        keepMethods: [
            'DisableMovement',
            'SetMovementMode'
        ],
        keepProperties: [
            'MovementMode'
        ]
    },
    {
        bucket: 'movement',
        name: 'UNavMovementComponent',
        keepMethods: [
            'GetVelocityForNavMovement',
            'IsMovingOnGround'
        ],
        keepProperties: [
            'NavAgentProps'
        ]
    },
    {
        bucket: 'camera',
        name: 'ACameraRig_Rail',
        keepMethods: [
            'GetRailSplineComponent'
        ],
        keepProperties: [
            'CurrentPositionOnRail',
            'RailSplineComponent'
        ]
    },
    {
        bucket: 'camera',
        name: 'UCameraComponent',
        keepMethods: [
            'GetCameraView',
            'SetAspectRatio'
        ],
        keepProperties: [
            'FieldOfView'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'FGameplayTag',
        keepMethods: [
            'GetGameplayTagParents',
            'MatchesTagExact'
        ]
    },
    {
        bucket: 'gameplay',
        name: 'FGameplayTagContainer',
        keepMethods: [
            'GetMatchedTags',
            'HasAll'
        ],
        keepProperties: [
            'GameplayTags'
        ]
    },
    {
        bucket: 'control',
        name: 'UWidget',
        keepMethods: [
            'GetAccessibleText'
        ],
        keepProperties: [
            'ToolTipWidget'
        ]
    },
    {
        bucket: 'control',
        name: 'AActor',
        keepMethods: [
            'GetActorNameOrLabel'
        ],
        keepProperties: [
            'ActorGuid'
        ]
    },
    {
        bucket: 'control',
        name: 'FInputDebugKeyBinding',
        keepMethods: [
            'Execute',
            'GetHandle'
        ]
    }
];

const SPECIAL_CASES = [
    {
        id: 'smart-bucket-gameplay',
        mode: 'smart',
        query: 'gameplay',
        topWindow: 12,
        expectWithinTop: [
            'GameplayTags::GameplayCue',
            'UGameplayAbility',
            'FGameplayTag'
        ]
    },
    {
        id: 'smart-bucket-ameplay',
        mode: 'smart',
        query: 'ameplay',
        topWindow: 12,
        expectWithinTop: [
            'GameplayTags::GameplayCue',
            'UGameplayAbility',
            'FGameplayTag'
        ]
    },
    {
        id: 'smart-bucket-ai',
        mode: 'smart',
        query: 'ai',
        topWindow: 12,
        expectWithinTop: [
            'AIHelper::GetAIController',
            'AAIController',
            'EAILockSource.Gameplay'
        ]
    },
    {
        id: 'smart-bucket-camera',
        mode: 'smart',
        query: 'camera',
        topWindow: 12,
        expectWithinTop: [
            'CameraPose::GetAimDir',
            'CameraVariableTable::GetFloatCameraVariable',
            'ACameraRig_Rail'
        ]
    },
    {
        id: 'smart-bucket-movement',
        mode: 'smart',
        query: 'movement',
        topWindow: 16,
        expectWithinTop: [
            'UMovementComponent',
            'UCharacterMovementComponent',
            'GameplayTags::Settings_Movement'
        ]
    },
    {
        id: 'smart-bucket-status',
        mode: 'smart',
        query: 'status',
        topWindow: 12,
        expectWithinTop: [
            'GameplayTags::Status',
            'GameplayTags::Status_StunGauge'
        ]
    },
    {
        id: 'smart-multi-gameplay-ai-pawn',
        mode: 'smart',
        query: 'gameplay ai pawn',
        topWindow: 12,
        expectWithinTop: [
            'GameplayTags::FeatureName_AIPawnData'
        ]
    },
    {
        id: 'smart-multi-camera-pose',
        mode: 'smart',
        query: 'camera pose',
        topWindow: 12,
        expectWithinTop: [
            'CameraPose::GetAimDir',
            'CameraPose::MakeCameraPoseFromCameraComponent'
        ]
    },
    {
        id: 'smart-multi-movement-component',
        mode: 'smart',
        query: 'movement component',
        topWindow: 12,
        expectWithinTop: [
            'UMovementComponent',
            'UCharacterMovementComponent'
        ]
    },
    {
        id: 'plain-gameplay-cue',
        mode: 'plain',
        query: 'gameplay cue',
        topWindow: 10,
        expectWithinTop: [
            'GameplayTags::GameplayCue'
        ]
    },
    {
        id: 'plain-callable-ability-system',
        mode: 'plain',
        query: 'ability system add gameplay tags(',
        topWindow: 10,
        expectWithinTop: [
            'AbilitySystem::AddGameplayTags'
        ]
    },
    {
        id: 'plain-callable-camera-pose',
        mode: 'plain',
        query: 'camera pose make camera pose(',
        topWindow: 10,
        expectWithinTop: [
            'CameraPose::MakeCameraPoseFromCameraComponent'
        ]
    }
];

function parseArgs(argv)
{
    const options = {
        cache: process.env[CACHE_PATH_ENV],
        output: DEFAULT_OUTPUT_PATH,
        stdout: false
    };

    for (let index = 0; index < argv.length; index += 1)
    {
        const arg = argv[index];
        if (arg === '--cache')
            options.cache = argv[++index];
        else if (arg === '--output')
            options.output = path.resolve(argv[++index]);
        else if (arg === '--stdout')
            options.stdout = true;
        else if (arg === '--help' || arg === '-h')
        {
            console.log(`Usage: node scripts/extract-api-search-fixture.js [--cache <path>] [--output <path>] [--stdout]\nCache source: --cache <path> or ${CACHE_PATH_ENV}=<path>`);
            process.exit(0);
        }
        else
        {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.cache)
        throw new Error(`Missing cache path. Pass --cache <path> or set ${CACHE_PATH_ENV}.`);

    return options;
}

function maskCachePath(cachePath)
{
    const normalized = cachePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const scriptIndex = parts.findIndex((part) => part.toLowerCase() === 'script');
    if (scriptIndex >= 2)
    {
        parts[scriptIndex - 2] = '<project>';
        parts[scriptIndex - 1] = '<game>';
        return parts.join('/');
    }

    return '<masked>/Script/.vscode/angelscript/unreal-cache.json';
}

function loadCache(cachePath)
{
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

function buildEntryMap(debugDatabaseChunks)
{
    const entryMap = new Map();
    for (const chunk of debugDatabaseChunks || [])
    {
        for (const [name, entry] of Object.entries(chunk || {}))
            entryMap.set(name, entry);
    }
    return entryMap;
}

function cloneEntry(rawEntry)
{
    return JSON.parse(JSON.stringify(rawEntry));
}

function pickEntry(entryMap, spec)
{
    const rawEntry = entryMap.get(spec.name);
    if (!rawEntry)
        throw new Error(`Missing entry in cache: ${spec.name}`);

    const picked = cloneEntry(rawEntry);
    if (Array.isArray(spec.keepMethods))
    {
        const methods = [];
        for (const methodName of spec.keepMethods)
        {
            const matchedMethod = (rawEntry.methods || []).find((method) => method.name === methodName);
            if (!matchedMethod)
                throw new Error(`Missing method for ${spec.name}: ${methodName}`);
            methods.push(matchedMethod);
        }
        picked.methods = methods;
    }
    else
    {
        delete picked.methods;
    }

    if (Array.isArray(spec.keepProperties))
    {
        const properties = {};
        for (const propertyName of spec.keepProperties)
        {
            if (!rawEntry.properties || !(propertyName in rawEntry.properties))
                throw new Error(`Missing property for ${spec.name}: ${propertyName}`);
            properties[propertyName] = rawEntry.properties[propertyName];
        }
        picked.properties = properties;
    }
    else
    {
        delete picked.properties;
    }

    return picked;
}

function publicEntryName(entryName, entry)
{
    if (entryName.startsWith('__'))
        return entryName.substring(2);
    return entryName;
}

function isNamespaceHelper(entryName, entry)
{
    return entryName.startsWith('__') && entry?.isEnum !== true;
}

function publicEntryQualifiedName(entryName, entry)
{
    if (isNamespaceHelper(entryName, entry))
        return null;
    return publicEntryName(entryName, entry);
}

function qualifiedMemberName(entryName, entry, memberName, memberKind)
{
    const publicName = publicEntryName(entryName, entry);
    if (isNamespaceHelper(entryName, entry))
        return `${publicName}::${memberName}`;
    return `${publicName}.${memberName}`;
}

function splitWords(value)
{
    let normalized = value.replace(/^__/, '');
    if (/^[A-Z][A-Z][a-z]/.test(normalized))
        normalized = normalized.substring(1);
    else if (/^[UAFESTI](?=[A-Z])/.test(normalized))
        normalized = normalized.substring(1);

    normalized = normalized
        .replace(/::/g, ' ')
        .replace(/[._]/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized)
        return [];

    const seen = new Set();
    const words = [];
    for (const word of normalized.split(' '))
    {
        const lower = word.toLowerCase();
        if (!seen.has(lower))
        {
            seen.add(lower);
            words.push(word);
        }
    }
    return words;
}

function buildFuzzyQuery(entryName, entry, memberName)
{
    const parts = [];
    if (memberName)
        parts.push(...splitWords(publicEntryName(entryName, entry)));
    parts.push(...splitWords(memberName ?? publicEntryName(entryName, entry)));
    return parts.join(' ');
}

function buildExactQuery(entryName, entry, memberName, memberKind)
{
    const qualified = memberName
        ? qualifiedMemberName(entryName, entry, memberName, memberKind)
        : publicEntryQualifiedName(entryName, entry);

    if (!qualified)
        throw new Error(`Cannot build exact query for namespace helper entry: ${entryName}`);

    if (memberKind === 'method')
        return `${qualified}(`;
    return qualified;
}

function buildBucketMetadata(specs)
{
    const buckets = {};
    for (const spec of specs)
    {
        if (!buckets[spec.bucket])
            buckets[spec.bucket] = [];
        buckets[spec.bucket].push(spec.name);
    }

    for (const names of Object.values(buckets))
        names.sort((left, right) => left.localeCompare(right));

    return buckets;
}

function createCases(specs, pickedEntries)
{
    const cases = [];
    const seen = new Set();

    function addCase(input)
    {
        const normalized = {
            topWindow: 10,
            expectWithinTop: [],
            ...input
        };

        normalized.expectWithinTop = [...normalized.expectWithinTop];
        const signature = JSON.stringify({
            mode: normalized.mode,
            query: normalized.query,
            topWindow: normalized.topWindow,
            expectWithinTop: normalized.expectWithinTop,
            expectFirst: normalized.expectFirst
        });
        if (seen.has(signature))
            return;
        seen.add(signature);
        cases.push(normalized);
    }

    for (const spec of specs)
    {
        const entry = pickedEntries.get(spec.name);
        const publicQualifiedName = publicEntryQualifiedName(spec.name, entry);

        if (publicQualifiedName)
        {
            const entryQuery = buildFuzzyQuery(spec.name, entry, null);
            addCase({
                id: `smart-entry-${publicQualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'smart',
                query: entryQuery,
                topWindow: 8,
                expectWithinTop: [publicQualifiedName]
            });
            addCase({
                id: `plain-entry-${publicQualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'plain',
                query: entryQuery,
                topWindow: 8,
                expectWithinTop: [publicQualifiedName]
            });
        }

        const methodNames = spec.keepMethods || [];
        for (const methodName of methodNames)
        {
            const qualifiedName = qualifiedMemberName(spec.name, entry, methodName, 'method');
            addCase({
                id: `smart-method-${qualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'smart',
                query: buildFuzzyQuery(spec.name, entry, methodName),
                topWindow: 10,
                expectWithinTop: [qualifiedName]
            });
            addCase({
                id: `plain-exact-method-${qualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'plain',
                query: buildExactQuery(spec.name, entry, methodName, 'method'),
                topWindow: 5,
                expectWithinTop: [qualifiedName],
                expectFirst: qualifiedName
            });
        }

        const propertyNames = spec.keepProperties || [];
        for (const propertyName of propertyNames)
        {
            const qualifiedName = qualifiedMemberName(spec.name, entry, propertyName, 'property');
            addCase({
                id: `smart-property-${qualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'smart',
                query: buildFuzzyQuery(spec.name, entry, propertyName),
                topWindow: 10,
                expectWithinTop: [qualifiedName]
            });
            addCase({
                id: `plain-exact-property-${qualifiedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                mode: 'plain',
                query: buildExactQuery(spec.name, entry, propertyName, 'property'),
                topWindow: 5,
                expectWithinTop: [qualifiedName],
                expectFirst: qualifiedName
            });
        }
    }

    for (const specialCase of SPECIAL_CASES)
        addCase(specialCase);

    cases.sort((left, right) => left.id.localeCompare(right.id));
    return cases;
}

function createFixture(cachePath)
{
    const cache = loadCache(cachePath);
    const entryMap = buildEntryMap(cache.debugDatabaseChunks);
    const pickedEntries = new Map();
    const debugDatabaseChunks = [];

    for (const spec of ENTRY_SPECS)
    {
        const picked = pickEntry(entryMap, spec);
        pickedEntries.set(spec.name, picked);
        debugDatabaseChunks.push({ [spec.name]: picked });
    }

    const cases = createCases(ENTRY_SPECS, pickedEntries);
    if (cases.length < 120 || cases.length > 180)
        throw new Error(`Expected 120-180 generated cases, received ${cases.length}`);

    return {
        version: 1,
        sourceCachePathMasked: maskCachePath(cachePath),
        sourceCacheVersion: cache.version,
        sourceCacheCreatedAt: cache.createdAt,
        selectionVersion: 1,
        metadata: {
            bucketEntries: buildBucketMetadata(ENTRY_SPECS),
            selectedEntries: ENTRY_SPECS.map((spec) => spec.name),
            caseCount: cases.length
        },
        debugDatabaseChunks,
        cases
    };
}

function main()
{
    const options = parseArgs(process.argv.slice(2));
    const fixture = createFixture(options.cache);
    const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`;

    if (options.stdout)
    {
        process.stdout.write(fixtureText);
        return;
    }

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, fixtureText, 'utf8');
    console.log(`Wrote ${fixture.metadata.caseCount} cases to ${options.output}`);
}

main();
