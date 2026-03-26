import * as assert from 'node:assert/strict';
import test = require('node:test');
import { formatPreviewLine, formatToolText, renderPreviewBlockLines } from '../toolTextFormatter';

test('preview line formatter uses stable line markers and spacing', () =>
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

test('searchApi success is rendered as grouped code-first text', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'MovementComponent',
                regex: false,
                limit: 20,
                source: 'both',
                scope: 'Gameplay::Movement',
                includeInheritedFromScope: true
            },
            scopeLookup: {
                requestedScope: 'Gameplay::Movement',
                resolvedQualifiedName: 'Gameplay::Movement::UMovementComponent',
                resolvedKind: 'class'
            },
            matchCounts: {
                total: 2,
                returned: 2,
                omitted: 0
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
                    matchReason: 'exact-qualified',
                    source: 'native',
                    signature: 'class Gameplay::Movement::UMovementComponent'
                },
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent.StartMovement',
                    kind: 'method',
                    matchReason: 'boundary-ordered',
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
        '// scope: class Gameplay::Movement::UMovementComponent',
        '// notice [SCOPE_INHERITANCE_EMPTY]: Scope "Gameplay::Movement::UMovementComponent" has no inherited members to expand.',
        '',
        '// namespace Gameplay::Movement',
        '// match: exact-qualified',
        '// native',
        'class UMovementComponent;',
        '====',
        '// Gameplay::Movement::UMovementComponent',
        '// match: boundary-ordered',
        '/**',
        ' * Starts movement on the current actor.',
        ' */',
        'void StartMovement();'
    ].join('\n'));
});

test('searchApi renders top-level returned count only when truncated', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'Movement',
                regex: false,
                limit: 2,
                source: 'both'
            },
            matchCounts: {
                total: 5,
                returned: 2,
                omitted: 3
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent',
                    kind: 'class',
                    matchReason: 'exact-qualified',
                    source: 'native',
                    signature: 'class Gameplay::Movement::UMovementComponent'
                },
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent.StartMovement',
                    kind: 'method',
                    matchReason: 'boundary-ordered',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Movement::UMovementComponent',
                    signature: 'void Gameplay::Movement::UMovementComponent.StartMovement()'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// returned: 2/5',
        '',
        '// namespace Gameplay::Movement',
        '// match: exact-qualified',
        '// native',
        'class UMovementComponent;',
        '====',
        '// Gameplay::Movement::UMovementComponent',
        '// match: boundary-ordered',
        'void StartMovement();'
    ].join('\n'));
});

test('searchApi groups multiple members under the same owner header', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'StartMovement IsMoving',
                regex: false,
                limit: 20,
                source: 'script',
                scope: 'Gameplay::Movement::UMovementComponent'
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent.StartMovement',
                    kind: 'method',
                    matchReason: 'boundary-ordered',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Movement::UMovementComponent',
                    signature: 'void Gameplay::Movement::UMovementComponent.StartMovement()'
                },
                {
                    qualifiedName: 'Gameplay::Movement::UMovementComponent.IsMoving',
                    kind: 'method',
                    matchReason: 'boundary-ordered',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Movement::UMovementComponent',
                    signature: 'protected bool Gameplay::Movement::UMovementComponent.IsMoving() const'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// Gameplay::Movement::UMovementComponent',
        '// match: boundary-ordered',
        'void StartMovement();',
        '',
        '// match: boundary-ordered',
        'protected bool IsMoving() const;'
    ].join('\n'));
});

test('searchApi renders mixin metadata in text output', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'UMovementDerived ApplyDerivedMovement',
                regex: false,
                limit: 20,
                source: 'both',
                scope: 'Gameplay::Movement::UMovementDerived',
                includeInheritedFromScope: true
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::ApplyDerivedMovement',
                    kind: 'function',
                    matchReason: 'ordered-wildcard',
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
        '// Gameplay::Movement',
        '// match: ordered-wildcard',
        '// mixin from Gameplay::Movement',
        '/**',
        ' * Applies derived movement through a mixin.',
        ' */',
        'void ApplyDerivedMovement(float Scale);'
    ].join('\n'));
});

test('searchApi prefers full documentation over summary when includeDocs is enabled', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'OpenPawnDataAIAsset(',
                regex: false,
                limit: 20,
                source: 'both',
                includeDocs: true
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset',
                    kind: 'method',
                    matchReason: 'exact-qualified',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Characters::UCthuAICharacterExtension',
                    signature: 'void Gameplay::Characters::UCthuAICharacterExtension.OpenPawnDataAIAsset(AActor SelectedActor)',
                    summary: 'Short summary that should not be rendered.',
                    documentation: 'Full documentation line 1.\n\nFull documentation line 2.'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// Gameplay::Characters::UCthuAICharacterExtension',
        '// match: exact-qualified',
        '/**',
        ' * Full documentation line 1.',
        ' *',
        ' * Full documentation line 2.',
        ' */',
        'void OpenPawnDataAIAsset(AActor SelectedActor);'
    ].join('\n'));
});

test('searchApi renders merged same-name scope groups as separate sections', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'Get',
                regex: false,
                limit: 2,
                source: 'script',
                scope: 'UCthuBattleSet'
            },
            scopeLookup: {
                requestedScope: 'UCthuBattleSet',
                resolvedQualifiedName: 'UCthuBattleSet',
                resolvedKind: 'class'
            },
            matchCounts: {
                total: 3,
                returned: 2,
                omitted: 1
            },
            scopeGroups: [
                {
                    scope: {
                        requestedScope: 'UCthuBattleSet',
                        resolvedQualifiedName: 'UCthuBattleSet',
                        resolvedKind: 'class'
                    },
                    totalMatches: 1,
                    omittedMatches: 0,
                    matches: [
                        {
                            qualifiedName: 'UCthuBattleSet.GetOwnedGameplayTags',
                            kind: 'method',
                            matchReason: 'boundary-ordered',
                            source: 'script',
                            containerQualifiedName: 'UCthuBattleSet',
                            signature: 'void UCthuBattleSet.GetOwnedGameplayTags()'
                        }
                    ]
                },
                {
                    scope: {
                        requestedScope: 'UCthuBattleSet',
                        resolvedQualifiedName: 'UCthuBattleSet',
                        resolvedKind: 'namespace'
                    },
                    totalMatches: 2,
                    omittedMatches: 1,
                    matches: [
                        {
                            qualifiedName: 'UCthuBattleSet::GetManaAttr',
                            kind: 'function',
                            matchReason: 'boundary-ordered',
                            source: 'script',
                            containerQualifiedName: 'UCthuBattleSet',
                            signature: 'FGameplayAttribute UCthuBattleSet::GetManaAttr()'
                        }
                    ]
                }
            ],
            matches: [
                {
                    qualifiedName: 'UCthuBattleSet.GetOwnedGameplayTags',
                    kind: 'method',
                    matchReason: 'boundary-ordered',
                    source: 'script',
                    containerQualifiedName: 'UCthuBattleSet',
                    signature: 'void UCthuBattleSet.GetOwnedGameplayTags()'
                },
                {
                    qualifiedName: 'UCthuBattleSet::GetManaAttr',
                    kind: 'function',
                    matchReason: 'boundary-ordered',
                    source: 'script',
                    containerQualifiedName: 'UCthuBattleSet',
                    signature: 'FGameplayAttribute UCthuBattleSet::GetManaAttr()'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// returned: 2/3',
        '',
        '// scope: class UCthuBattleSet',
        '// UCthuBattleSet',
        '// match: boundary-ordered',
        'void GetOwnedGameplayTags();',
        '====',
        '// scope: namespace UCthuBattleSet',
        '// returned: 1/2',
        '',
        '// UCthuBattleSet',
        '// match: boundary-ordered',
        'FGameplayAttribute GetManaAttr();'
    ].join('\n'));
});

test('searchApi renders empty results as a code-style comment', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'DefinitelyMissingSymbol',
                regex: false,
                limit: 20,
                source: 'both'
            },
            matchCounts: {
                total: 0,
                returned: 0,
                omitted: 0
            },
            matches: []
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// No matches found.'
    ].join('\n'));
});

test('searchApi does not render ignored inherited-scope noise for auto namespace scopes', () =>
{
    const text = formatToolText('angelscript_searchApi', {
        ok: true,
        data: {
            request: {
                query: 'Movement',
                regex: false,
                limit: 20,
                source: 'both',
                scope: 'Gameplay::Movement',
                includeInheritedFromScopeMode: 'auto',
                includeInheritedFromScope: false,
                includeDocs: false
            },
            scopeLookup: {
                requestedScope: 'Gameplay::Movement',
                resolvedQualifiedName: 'Gameplay::Movement',
                resolvedKind: 'namespace'
            },
            matchCounts: {
                total: 1,
                returned: 1,
                omitted: 0
            },
            matches: [
                {
                    qualifiedName: 'Gameplay::Movement::BuildMovementPath',
                    kind: 'function',
                    matchReason: 'ordered-wildcard',
                    source: 'script',
                    containerQualifiedName: 'Gameplay::Movement',
                    signature: 'void Gameplay::Movement::BuildMovementPath(FVector Target)'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript API search',
        '// scope: namespace Gameplay::Movement',
        '',
        '// Gameplay::Movement',
        '// match: ordered-wildcard',
        'void BuildMovementPath(FVector Target);'
    ].join('\n'));
});

test('resolveSymbol success renders doc comment and preview-first output', () =>
{
    const text = formatToolText('angelscript_resolveSymbolAtPosition', {
        ok: true,
        data: {
            request: {
                filePath: 'G:/Project/Game/Characters/Hero.as',
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
                    filePath: 'G:/Project/Game/Characters/Hero.as',
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
        '/**',
        ' * Moves the character toward the target actor.',
        ' */',
        '',
        '// definition: G:/Project/Game/Characters/Hero.as:319-323',
        '319-        UFUNCTION(BlueprintCallable)',
        '320:        void JumpToTarget(AActor Target)',
        '321:        {',
        '322:            MoveToActor(Target);',
        '323:        }'
    ].join('\n'));
});

test('resolveSymbol normalizes markdown docs when falling back to declaration text', () =>
{
    const text = formatToolText('angelscript_resolveSymbolAtPosition', {
        ok: true,
        data: {
            symbol: {
                name: 'JumpToTarget',
                kind: 'method',
                signature: 'void JumpToTarget(AActor Target)',
                doc: {
                    format: 'markdown',
                    text: '**Moves** the `target` actor.\n\n- Uses pathfinding.\n\n@param Target Actor to move to.'
                }
            }
        }
    });

    assert.equal(text, [
        'Angelscript resolve symbol',
        '/**',
        ' * Moves the target actor.',
        ' *',
        ' * - Uses pathfinding.',
        ' *',
        ' * @param Target Actor to move to.',
        ' */',
        '',
        'void JumpToTarget(AActor Target);'
    ].join('\n'));
});

test('getTypeMembers success renders member list blocks', () =>
{
    const text = formatToolText('angelscript_getTypeMembers', {
        ok: true,
        data: {
            type: {
                qualifiedName: 'Gameplay::UMovementComponent',
                namespace: 'Gameplay',
                description: 'Movement component overview.'
            },
            request: {
                includeInherited: true,
                includeDocs: true
            },
            members: [
                {
                    kind: 'method',
                    visibility: 'public',
                    name: 'StartMovement',
                    declaredIn: 'UMovementComponent',
                    isInherited: false,
                    signature: 'public void UMovementComponent.StartMovement()'
                },
                {
                    kind: 'property',
                    visibility: 'protected',
                    name: 'MaxSpeed',
                    declaredIn: 'UBaseMovementComponent',
                    isInherited: true,
                    signature: 'protected float UBaseMovementComponent.MaxSpeed',
                    description: 'Maximum movement speed in units per second.'
                },
                {
                    kind: 'method',
                    visibility: 'private',
                    name: 'IsMoving',
                    declaredIn: 'UMovementComponent',
                    isInherited: false,
                    signature: 'private bool UMovementComponent.IsMoving() const'
                },
                {
                    kind: 'method',
                    visibility: 'public',
                    name: 'ApplyDerivedMovement',
                    declaredIn: 'Gameplay::Movement',
                    declaredInKind: 'namespace',
                    isInherited: false,
                    isMixin: true,
                    signature: 'void UMovementComponent.ApplyDerivedMovement(float Scale)',
                    description: 'Applies derived movement through a mixin.'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript type members',
        'type: Gameplay::UMovementComponent',
        '====',
        '/**',
        ' * Movement component overview.',
        ' */',
        '',
        'void StartMovement();',
        '',
        '// inherited from UBaseMovementComponent',
        '/**',
        ' * Maximum movement speed in units per second.',
        ' */',
        'protected float MaxSpeed;',
        '',
        'private bool IsMoving() const;',
        '',
        '// mixin from Gameplay::Movement',
        '/**',
        ' * Applies derived movement through a mixin.',
        ' */',
        'void ApplyDerivedMovement(float Scale);'
    ].join('\n'));
});

test('getTypeMembers strips explicit public modifiers from declaration-style text output', () =>
{
    const text = formatToolText('angelscript_getTypeMembers', {
        ok: true,
        data: {
            type: {
                qualifiedName: 'Gameplay::UPlainComponent',
                namespace: 'Gameplay',
                description: ''
            },
            request: {
                includeInherited: false,
                includeDocs: false
            },
            members: [
                {
                    kind: 'property',
                    visibility: 'public',
                    name: 'InternalOffset',
                    declaredIn: 'UPlainComponent',
                    isInherited: false,
                    signature: 'public FVector UPlainComponent.InternalOffset'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript type members',
        'type: Gameplay::UPlainComponent',
        '====',
        'FVector InternalOffset;'
    ].join('\n'));
});

test('getTypeMembers omits an empty target description block and empty member descriptions', () =>
{
    const text = formatToolText('angelscript_getTypeMembers', {
        ok: true,
        data: {
            type: {
                qualifiedName: 'Gameplay::UPlainComponent',
                namespace: 'Gameplay',
                description: ''
            },
            request: {
                includeInherited: false,
                includeDocs: false
            },
            members: [
                {
                    kind: 'method',
                    visibility: 'public',
                    name: 'StartMovement',
                    declaredIn: 'UPlainComponent',
                    isInherited: false,
                    signature: 'void UPlainComponent.StartMovement()',
                    description: ''
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript type members',
        'type: Gameplay::UPlainComponent',
        '====',
        'void StartMovement();'
    ].join('\n'));
});

test('getClassHierarchy success renders lineage comments and source blocks', () =>
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
                AMyHeroCharacter: ['AChildCharacter'],
                AChildCharacter: ['AGrandChildCharacter']
            },
            sourceByClass: {
                AActor: {
                    source: 'cpp'
                },
                AChildCharacter: {
                    source: 'cpp'
                },
                AMyHeroCharacter: {
                    source: 'as',
                    filePath: 'G:/Project/Game/Characters/MyHeroCharacter.as',
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
        '// lineage: AActor <- APawn <- AHazeCharacter <- AMyHeroCharacter',
        '',
        '// derived:',
        '//   AMyHeroCharacter',
        '//     AChildCharacter',
        '//       AGrandChildCharacter',
        '',
        '// G:/Project/Game/Characters/MyHeroCharacter.as',
        '12:        class AMyHeroCharacter : AHazeCharacter',
        '13:        {',
        '14:            UPROPERTY()',
        '15:            float MaxSpeed = 600.0f;',
        '',
        '// native',
        'class AActor;',
        '',
        '// native',
        'class AChildCharacter;'
    ].join('\n'));
});

test('getClassHierarchy renders truncation comments only when hierarchy is clipped', () =>
{
    const text = formatToolText('angelscript_getClassHierarchy', {
        ok: true,
        data: {
            root: 'AMyHeroCharacter',
            supers: ['AHazeCharacter'],
            truncated: {
                supers: true,
                derivedDepth: true,
                derivedBreadthByClass: {
                    AMyHeroCharacter: 5
                }
            },
            derivedByParent: {
                AMyHeroCharacter: ['AChildCharacter']
            },
            sourceByClass: {
                AMyHeroCharacter: {
                    source: 'cpp'
                }
            }
        }
    });

    assert.equal(text, [
        'Angelscript class hierarchy',
        '// lineage: AHazeCharacter <- AMyHeroCharacter',
        '',
        '// derived:',
        '//   AMyHeroCharacter',
        '//     AChildCharacter',
        '',
        '// truncated: supers=true, derivedDepth=true, derivedBreadthByClass=AMyHeroCharacter=5',
        '',
        '// native',
        'class AMyHeroCharacter;'
    ].join('\n'));
});

test('findReferences success renders file comments and preview blocks', () =>
{
    const text = formatToolText('angelscript_findReferences', {
        ok: true,
        data: {
            total: 2,
            returned: 2,
            limit: 30,
            truncated: false,
            request: {
                filePath: 'G:/Project/Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                },
                limit: 30
            },
            references: [
                {
                    filePath: 'G:/Project/Game/Characters/Hero.as',
                    startLine: 128,
                    endLine: 128,
                    range: {
                        start: { line: 128, character: 5 },
                        end: { line: 128, character: 17 }
                    },
                    preview: '    JumpToTarget(TargetActor);'
                },
                {
                    filePath: 'G:/Project/Game/Abilities/JumpAbility.as',
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
        '// G:/Project/Game/Characters/Hero.as',
        '// range: 128:5-128:17',
        '128:        JumpToTarget(TargetActor);',
        '====',
        '// G:/Project/Game/Abilities/JumpAbility.as',
        '// range: 45:10-45:22',
        '45:        Hero.JumpToTarget(TargetActor);'
    ].join('\n'));
});

test('findReferences keeps multiple references in the same file grouped without separators', () =>
{
    const text = formatToolText('angelscript_findReferences', {
        ok: true,
        data: {
            total: 2,
            returned: 2,
            limit: 30,
            truncated: false,
            request: {
                filePath: 'G:/Project/Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                },
                limit: 30
            },
            references: [
                {
                    filePath: 'G:/Project/Game/Characters/Hero.as',
                    startLine: 128,
                    endLine: 128,
                    range: {
                        start: { line: 128, character: 5 },
                        end: { line: 128, character: 17 }
                    },
                    preview: '    JumpToTarget(TargetActor);'
                },
                {
                    filePath: 'G:/Project/Game/Characters/Hero.as',
                    startLine: 140,
                    endLine: 140,
                    range: {
                        start: { line: 140, character: 9 },
                        end: { line: 140, character: 21 }
                    },
                    preview: '    Owner.JumpToTarget(TargetActor);'
                }
            ]
        }
    });

    assert.equal(text, [
        'Angelscript references',
        '// G:/Project/Game/Characters/Hero.as',
        '// range: 128:5-128:17',
        '128:        JumpToTarget(TargetActor);',
        '',
        '// range: 140:9-140:21',
        '140:        Owner.JumpToTarget(TargetActor);'
    ].join('\n'));
});

test('findReferences renders truncation metadata and notice', () =>
{
    const text = formatToolText('angelscript_findReferences', {
        ok: true,
        data: {
            total: 35,
            returned: 2,
            limit: 2,
            truncated: true,
            request: {
                filePath: 'G:/Project/Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                },
                limit: 2
            },
            references: [
                {
                    filePath: 'G:/Project/Game/Characters/Hero.as',
                    startLine: 128,
                    endLine: 128,
                    range: {
                        start: { line: 128, character: 5 },
                        end: { line: 128, character: 17 }
                    },
                    preview: '    JumpToTarget(TargetActor);'
                },
                {
                    filePath: 'G:/Project/Game/Abilities/JumpAbility.as',
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
        '// returned: 2/35',
        '',
        '// G:/Project/Game/Characters/Hero.as',
        '// range: 128:5-128:17',
        '128:        JumpToTarget(TargetActor);',
        '====',
        '// G:/Project/Game/Abilities/JumpAbility.as',
        '// range: 45:10-45:22',
        '45:        Hero.JumpToTarget(TargetActor);'
    ].join('\n'));
});

test('findReferences renders empty results as a code-style comment', () =>
{
    const text = formatToolText('angelscript_findReferences', {
        ok: true,
        data: {
            total: 0,
            returned: 0,
            limit: 30,
            truncated: false,
            request: {
                filePath: 'G:/Project/Game/Characters/Hero.as',
                position: {
                    line: 128,
                    character: 17
                },
                limit: 30
            },
            references: []
        }
    });

    assert.equal(text, [
        'Angelscript references',
        '// No references found.'
    ].join('\n'));
});

test('getClassHierarchy degrades unresolved script preview without failing text output', () =>
{
    const text = formatToolText('angelscript_getClassHierarchy', {
        ok: true,
        data: {
            root: 'AMyHeroCharacter',
            supers: [],
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
            derivedByParent: {},
            sourceByClass: {
                AMyHeroCharacter: {
                    source: 'as',
                    startLine: 12,
                    endLine: 15,
                    preview: '<source unavailable>'
                }
            }
        }
    });

    assert.equal(text, [
        'Angelscript class hierarchy',
        '// lineage: AMyHeroCharacter',
        '',
        '// derived:',
        '//   <none>',
        '',
        '// source unavailable',
        'class AMyHeroCharacter;'
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
