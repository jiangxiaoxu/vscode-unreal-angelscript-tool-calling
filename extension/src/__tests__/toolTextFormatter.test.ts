import * as assert from 'node:assert/strict';
import test = require('node:test');
import { formatPreviewLine, formatToolText, renderPreviewBlockLines } from '../toolTextFormatter';

test('preview line formatter uses qgrep-style markers and spacing', () =>
{
    assert.equal(formatPreviewLine(42, true, 'match text'), '42:    match text');
    assert.equal(formatPreviewLine(43, false, 'context text'), '43-    context text');
});

test('preview renderer marks macro backtrack as context and definition lines as matches', () =>
{
    assert.deepEqual(
        renderPreviewBlockLines({
            startLine: 319,
            endLine: 323,
            matchStartLine: 320,
            matchEndLine: 323,
            preview: [
                '    UFUNCTION(BlueprintCallable)',
                '    void JumpToTarget(AActor Target)',
                '    {',
                '        MoveToActor(Target);',
                '    }'
            ].join('\n')
        }),
        [
            '319-        UFUNCTION(BlueprintCallable)',
            '320:        void JumpToTarget(AActor Target)',
            '321:        {',
            '322:            MoveToActor(Target);',
            '323:        }'
        ]
    );
});

test('searchApi success is rendered in qgrep-style text', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'MovementComponent',
                mode: 'smart',
                limit: 20,
                source: 'both',
                kinds: ['class', 'method'],
                scopePrefix: 'Gameplay::Movement',
                includeInheritedFromScope: true
            },
            scopeLookup: {
                requestedPrefix: 'Gameplay::Movement',
                resolvedQualifiedName: 'Gameplay::Movement::UMovementComponent',
                resolvedKind: 'class'
            },
            inheritedScopeOutcome: 'applied',
            notices: [
                {
                    code: 'SCOPE_INHERITANCE_EMPTY',
                    message: 'Scope "Gameplay::Movement::UMovementComponent" has no inherited members to expand.'
                }
            ],
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent',
                    kind: 'class',
                    source: 'native',
                    signature: 'class Gameplay::Movement::UMovementComponent'
                },
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent.StartMovement',
                    kind: 'method',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Movement::UMovementComponent',
                    scopeRelationship: 'declared',
                    scopeDistance: 0,
                    signature: 'void Gameplay::Movement::UMovementComponent.StartMovement()',
                    summary: 'Starts movement on the current actor.'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        'query: MovementComponent',
        'mode: smart',
        'limit: 20',
        'source: native|script',
        'kinds: class|method',
        'scopePrefix: Gameplay::Movement',
        'includeInheritedFromScope: true',
        'inheritedScopeOutcome: applied',
        'count: 2',
        'scopeLookup: class Gameplay::Movement::UMovementComponent',
        '====',
        'notices',
        '---',
        'code: SCOPE_INHERITANCE_EMPTY',
        'message: Scope "Gameplay::Movement::UMovementComponent" has no inherited members to expand.',
        '====',
        'matches',
        '---',
        'qualifiedName: Gameplay::Movement::UMovementComponent',
        'kind: class',
        'source: native',
        'signature: class Gameplay::Movement::UMovementComponent',
        '---',
        'qualifiedName: Gameplay::Movement::UMovementComponent.StartMovement',
        'kind: method',
        'source: script',
        'container: Gameplay::Movement::UMovementComponent',
        'scopeRelationship: declared',
        'scopeDistance: 0',
        'signature: void Gameplay::Movement::UMovementComponent.StartMovement()',
        'summary:',
        'Starts movement on the current actor.'
    ].join('\n'));
});

test('searchApi source keeps native and script labels unchanged', () =>
{
    const nativeText = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'MovementComponent',
                mode: 'smart',
                limit: 20,
                source: 'native'
            },
            matches: []
        }
    });
    assert.match(nativeText, /source: native/u);

    const scriptText = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'MovementComponent',
                mode: 'smart',
                limit: 20,
                source: 'script'
            },
            matches: []
        }
    });
    assert.match(scriptText, /source: script/u);
});

test('searchApi renders mixin metadata in text output', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'UMovementDerived ApplyDerivedMovement',
                mode: 'smart',
                limit: 20,
                source: 'both',
                kinds: ['function'],
                scopePrefix: 'Gameplay::Movement::UMovementDerived',
                includeInheritedFromScope: true
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::ApplyDerivedMovement',
                    kind: 'function',
                    source: 'script',
                    isMixin: true,
                    containerQualifiedName: 'Gameplay::Movement',
                    scopeRelationship: 'mixin',
                    scopeDistance: 0,
                    signature: 'void UMovementDerived.ApplyDerivedMovement(float Scale)',
                    summary: 'Applies derived movement through a mixin.'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        'query: UMovementDerived ApplyDerivedMovement',
        'mode: smart',
        'limit: 20',
        'source: native|script',
        'kinds: function',
        'scopePrefix: Gameplay::Movement::UMovementDerived',
        'includeInheritedFromScope: true',
        'count: 1',
        '====',
        'matches',
        '---',
        'qualifiedName: Gameplay::Movement::ApplyDerivedMovement',
        'kind: function',
        'source: script',
        'isMixin: true',
        'container: Gameplay::Movement',
        'scopeRelationship: mixin',
        'scopeDistance: 0',
        'signature: void UMovementDerived.ApplyDerivedMovement(float Scale)',
        'summary:',
        'Applies derived movement through a mixin.'
    ].join('\n'));
});

test('resolveSymbol success renders request fields and preview block', () =>
{
    const text = formatToolText('angelscript_resolveSymbolAtPosition', {
        ok: true,
        data: {
            request: {
                filePath: 'Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                },
                includeDocumentation: true
            },
            symbol: {
                name: 'JumpToTarget',
                kind: 'method',
                signature: 'void JumpToTarget(AActor Target)',
                definition: {
                    filePath: 'Game/Characters/Hero.as',
                    startLine: 319,
                    endLine: 323,
                    matchStartLine: 320,
                    matchEndLine: 323,
                    preview: [
                        '    UFUNCTION(BlueprintCallable)',
                        '    void JumpToTarget(AActor Target)',
                        '    {',
                        '        MoveToActor(Target);',
                        '    }'
                    ].join('\n')
                },
                doc: {
                    format: 'plaintext',
                    text: 'Moves the character toward the target actor.'
                }
            }
        }
    });

    assert.equal(text, [
        'Angelscript resolve symbol',
        'file: Game/Characters/Hero.as',
        'position: 128:17',
        'symbol: JumpToTarget',
        'kind: method',
        'signature: void JumpToTarget(AActor Target)',
        'definition: Game/Characters/Hero.as:319-323',
        '====',
        'Game/Characters/Hero.as',
        '319-        UFUNCTION(BlueprintCallable)',
        '320:        void JumpToTarget(AActor Target)',
        '321:        {',
        '322:            MoveToActor(Target);',
        '323:        }',
        '---',
        'doc',
        'Moves the character toward the target actor.'
    ].join('\n'));
});

test('getTypeMembers success renders member list blocks', () =>
{
    const text = formatToolText('angelscript_getTypeMembers', {
        ok: true,
        data: {
            type: {
                qualifiedName: 'Gameplay::UMovementComponent',
                namespace: 'Gameplay'
            },
            request: {
                includeInherited: true,
                includeDocs: true
            },
            members: [
                {
                    kind: 'method',
                    visibility: 'public',
                    declaredIn: 'UMovementComponent',
                    isInherited: false,
                    signature: 'void StartMovement()'
                },
                {
                    kind: 'property',
                    visibility: 'protected',
                    declaredIn: 'UBaseMovementComponent',
                    isInherited: true,
                    signature: 'float MaxSpeed',
                    description: 'Maximum movement speed in units per second.'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript type members',
        'type: Gameplay::UMovementComponent',
        'namespace: Gameplay',
        'count: 2',
        'includeInherited: true',
        'includeDocs: true',
        '====',
        'members',
        '---',
        'kind: method',
        'visibility: public',
        'declaredIn: UMovementComponent',
        'inherited: false',
        'signature: void StartMovement()',
        '---',
        'kind: property',
        'visibility: protected',
        'declaredIn: UBaseMovementComponent',
        'inherited: true',
        'signature: float MaxSpeed',
        'description:',
        'Maximum movement speed in units per second.'
    ].join('\n'));
});

test('getClassHierarchy success renders hierarchy summary and source blocks', () =>
{
    const text = formatToolText('angelscript_getClassHierarchy', {
        ok: true,
        data: {
            root: 'AMyHeroCharacter',
            supers: ['AHazeCharacter', 'APawn', 'AActor'],
            limits: {
                maxSuperDepth: 3,
                maxSubDepth: 2,
                maxSubBreadth: 10
            },
            truncated: {
                supers: false,
                derivedDepth: false,
                derivedBreadthByClass: {}
            },
            derivedByParent: {
                AHazeCharacter: ['AMyHeroCharacter', 'AEnemyCharacter']
            },
            sourceByClass: {
                AActor: {
                    source: 'cpp'
                },
                AMyHeroCharacter: {
                    source: 'as',
                    filePath: 'Game/Characters/MyHeroCharacter.as',
                    startLine: 12,
                    endLine: 15,
                    preview: [
                        '    class AMyHeroCharacter : AHazeCharacter',
                        '    {',
                        '        UPROPERTY()',
                        '        float MaxSpeed = 600.0f;'
                    ].join('\n')
                }
            }
        }
    });

    assert.equal(text, [
        'Angelscript class hierarchy',
        'root: AMyHeroCharacter',
        'supers: AHazeCharacter -> APawn -> AActor',
        'limits: super=3, subDepth=2, subBreadth=10',
        'truncated: supers=false, derivedDepth=false',
        '====',
        'derivedByParent',
        '---',
        'AHazeCharacter: AMyHeroCharacter, AEnemyCharacter',
        '====',
        'AActor',
        'class: AActor',
        'source: cpp',
        '====',
        'Game/Characters/MyHeroCharacter.as',
        'class: AMyHeroCharacter',
        'source: as',
        '12:        class AMyHeroCharacter : AHazeCharacter',
        '13:        {',
        '14:            UPROPERTY()',
        '15:            float MaxSpeed = 600.0f;'
    ].join('\n'));
});

test('findReferences success renders per-file blocks and ranges', () =>
{
    const text = formatToolText('angelscript_findReferences', {
        ok: true,
        data: {
            total: 2,
            request: {
                filePath: 'Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                }
            },
            references: [
                {
                    filePath: 'Game/Characters/Hero.as',
                    startLine: 128,
                    endLine: 128,
                    range: {
                        start: { line: 128, character: 5 },
                        end: { line: 128, character: 17 }
                    },
                    preview: '    JumpToTarget(TargetActor);'
                },
                {
                    filePath: 'Game/Abilities/JumpAbility.as',
                    startLine: 45,
                    endLine: 45,
                    range: {
                        start: { line: 45, character: 10 },
                        end: { line: 45, character: 22 }
                    },
                    preview: '    Hero.JumpToTarget(TargetActor);'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript references',
        'file: Game/Characters/Hero.as',
        'position: 128:17',
        'count: 2',
        '====',
        'Game/Characters/Hero.as',
        '---',
        'range: 128:5-128:17',
        '128:        JumpToTarget(TargetActor);',
        '====',
        'Game/Abilities/JumpAbility.as',
        '---',
        'range: 45:10-45:22',
        '45:        Hero.JumpToTarget(TargetActor);'
    ].join('\n'));
});

test('searchApi error renders title and code', () =>
{
    assert.equal(
        formatToolText('angelscript_searchApi', {
            ok: false,
            error: {
                code: 'MISSING_QUERY',
                message: 'Missing query. Please provide query.'
            }
        }),
        [
            'Angelscript API search',
            'error: Missing query. Please provide query.',
            'code: MISSING_QUERY'
        ].join('\n')
    );
});

test('resolveSymbol error renders title and code', () =>
{
    assert.equal(
        formatToolText('angelscript_resolveSymbolAtPosition', {
            ok: false,
            error: {
                code: 'InvalidParams',
                message: "Invalid params. 'line' and 'character' must be positive integers (1-based)."
            }
        }),
        [
            'Angelscript resolve symbol',
            "error: Invalid params. 'line' and 'character' must be positive integers (1-based).",
            'code: InvalidParams'
        ].join('\n')
    );
});

test('getTypeMembers error renders title and code', () =>
{
    assert.equal(
        formatToolText('angelscript_getTypeMembers', {
            ok: false,
            error: {
                code: 'InvalidParams',
                message: "Invalid params. 'name' must be a non-empty string."
            }
        }),
        [
            'Angelscript type members',
            "error: Invalid params. 'name' must be a non-empty string.",
            'code: InvalidParams'
        ].join('\n')
    );
});

test('getClassHierarchy error renders title and code', () =>
{
    assert.equal(
        formatToolText('angelscript_getClassHierarchy', {
            ok: false,
            error: {
                code: 'NotFound',
                message: 'Class not found.'
            }
        }),
        [
            'Angelscript class hierarchy',
            'error: Class not found.',
            'code: NotFound'
        ].join('\n')
    );
});

test('findReferences error renders title and code', () =>
{
    assert.equal(
        formatToolText('angelscript_findReferences', {
            ok: false,
            error: {
                code: 'NotReady',
                message: 'References are not available yet. Please wait for script parsing to finish and try again.'
            }
        }),
        [
            'Angelscript references',
            'error: References are not available yet. Please wait for script parsing to finish and try again.',
            'code: NotReady'
        ].join('\n')
    );
});
