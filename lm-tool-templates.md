# LM Tool Templates

## Table of Contents
[Shared Conventions](#shared-conventions)
[angelscript_searchApi](#angelscript_searchapi)
[angelscript_resolveSymbolAtPosition](#angelscript_resolvesymbolatposition)
[angelscript_getTypeMembers](#angelscript_gettypemembers)
[angelscript_getClassHierarchy](#angelscript_getclasshierarchy)
[angelscript_findReferences](#angelscript_findreferences)
[Maintenance Rules](#maintenance-rules)

## Shared Conventions

- `filePath` values are normalized absolute paths.
- Tool `position.line` and `position.character` are 1-based in the public tool contract.
- Success payloads always include human-readable `text`.
- Structured `json` is included only when `UnrealAngelscript.languageModelTools.outputMode=text+structured`.
- Success `text` uses a code-first style:
  - stable title line
  - optional compact header comments in the form `// key: value`
  - declarations, hierarchy snippets, or source previews as the main body
  - normalized docs rendered as `/** ... */`
- The templates below are shape references, not byte-for-byte snapshots. Keep them aligned with current formatter behavior and public contract semantics.

## `angelscript_searchApi`

Purpose:
- Search Angelscript API symbols by query, optional scope, and optional filters.

Representative input:
```json
{
  "query": "BeginPlay",
  "mode": "smart",
  "source": "both",
  "scope": "AActor",
  "includeDocs": true,
  "symbolLevel": "all"
}
```

Representative success `text`:
```txt
Angelscript API search
// query: BeginPlay | mode=smart | source=both
// scope: class AActor | inherited:auto

// AActor
// native
/**
 * Called when play begins.
 */
void BeginPlay();
```

Representative success `json`:
```json
{
  "ok": true,
  "data": {
    "matches": [
      {
        "qualifiedName": "AActor::BeginPlay",
        "kind": "method",
        "signature": "void BeginPlay()",
        "matchReason": "exact-short",
        "documentation": "Called when play begins.",
        "source": "native",
        "scopeRelationship": "declared"
      }
    ],
    "matchCounts": {
      "total": 1,
      "returned": 1,
      "omitted": 0
    },
    "scopeLookup": {
      "requestedScope": "AActor",
      "resolvedQualifiedName": "AActor",
      "resolvedKind": "class"
    },
    "request": {
      "query": "BeginPlay",
      "mode": "smart",
      "limit": 20,
      "source": "both",
      "scope": "AActor",
      "includeDocs": true,
      "symbolLevel": "all"
    }
  }
}
```

Representative error:
```txt
Angelscript API search
error: Invalid params. 'query' must be a non-empty string.
code: InvalidParams
```

## `angelscript_resolveSymbolAtPosition`

Purpose:
- Resolve the symbol, docs, and optional definition preview at a file position.

Representative input:
```json
{
  "filePath": "G:/Project/Game/Characters/Hero.as",
  "position": {
    "line": 128,
    "character": 17
  },
  "includeDocumentation": true
}
```

Representative success `text`:
```txt
Angelscript resolve symbol
// input: G:/Project/Game/Characters/Hero.as:128:17 | docs:on

/**
 * Moves the character toward the target actor.
 */

// definition: G:/Project/Game/Characters/Hero.as:319-323
319-        UFUNCTION(BlueprintCallable)
320:        void JumpToTarget(AActor Target)
321:        {
322:            MoveToActor(Target);
323:        }
```

Representative success `json`:
```json
{
  "ok": true,
  "data": {
    "symbol": {
      "kind": "method",
      "name": "JumpToTarget",
      "signature": "void JumpToTarget(AActor Target)",
      "doc": {
        "format": "plaintext",
        "text": "Moves the character toward the target actor."
      },
      "definition": {
        "filePath": "G:/Project/Game/Characters/Hero.as",
        "startLine": 319,
        "endLine": 323,
        "preview": "    UFUNCTION(BlueprintCallable)\n    void JumpToTarget(AActor Target)\n    {\n        MoveToActor(Target);\n    }",
        "matchStartLine": 320,
        "matchEndLine": 323
      }
    },
    "request": {
      "filePath": "G:/Project/Game/Characters/Hero.as",
      "position": {
        "line": 128,
        "character": 17
      },
      "includeDocumentation": true
    }
  }
}
```

Representative error:
```txt
Angelscript resolve symbol
error: Invalid params. 'line' and 'character' must be positive integers (1-based).
code: InvalidParams
```

## `angelscript_getTypeMembers`

Purpose:
- List members for one exact type, optionally with inheritance and docs.

Representative input:
```json
{
  "name": "UMovementComponent",
  "namespace": "Gameplay",
  "includeInherited": true,
  "includeDocs": true,
  "kinds": "both"
}
```

Representative success `text`:
```txt
Angelscript type members
// request: inherited:on | docs:on | kinds=both
// namespace: Gameplay
type: Gameplay::UMovementComponent
====
/**
 * Movement component overview.
 */

void StartMovement();

// inherited from UBaseMovementComponent
/**
 * Maximum movement speed in units per second.
 */
protected float MaxSpeed;
```

Representative success `json`:
```json
{
  "ok": true,
  "data": {
    "type": {
      "name": "UMovementComponent",
      "namespace": "Gameplay",
      "qualifiedName": "Gameplay::UMovementComponent",
      "description": "Movement component overview."
    },
    "members": [
      {
        "kind": "method",
        "name": "StartMovement",
        "signature": "public void UMovementComponent.StartMovement()",
        "description": "",
        "declaredIn": "UMovementComponent",
        "declaredInKind": "type",
        "isInherited": false,
        "isMixin": false,
        "isAccessor": false,
        "visibility": "public"
      },
      {
        "kind": "property",
        "name": "MaxSpeed",
        "signature": "protected float UBaseMovementComponent.MaxSpeed",
        "description": "Maximum movement speed in units per second.",
        "declaredIn": "UBaseMovementComponent",
        "declaredInKind": "type",
        "isInherited": true,
        "isMixin": false,
        "isAccessor": false,
        "visibility": "protected"
      }
    ],
    "request": {
      "name": "UMovementComponent",
      "namespace": "Gameplay",
      "includeInherited": true,
      "includeDocs": true,
      "kinds": "both"
    }
  }
}
```

Representative error:
```txt
Angelscript type members
error: Invalid params. 'name' must be a non-empty string.
code: InvalidParams
```

## `angelscript_getClassHierarchy`

Purpose:
- Return parent lineage, derived classes, and optional source previews for one exact class.

Representative input:
```json
{
  "name": "AMyHeroCharacter",
  "maxSuperDepth": 3,
  "maxSubDepth": 2,
  "maxSubBreadth": 10
}
```

Representative success `text`:
```txt
Angelscript class hierarchy
// limits: super=3 | sub=2 | breadth=10
// lineage: AActor <- APawn <- AHazeCharacter <- AMyHeroCharacter

// derived:
// AMyHeroCharacter
//   - AMyDerivedHero
```

Representative success `json`:
```json
{
  "ok": true,
  "data": {
    "root": "AMyHeroCharacter",
    "supers": [
      "AHazeCharacter",
      "APawn",
      "AActor"
    ],
    "derivedByParent": {
      "AMyHeroCharacter": [
        "AMyDerivedHero"
      ]
    },
    "sourceByClass": {
      "AMyHeroCharacter": {
        "source": "cpp"
      }
    },
    "limits": {
      "maxSuperDepth": 3,
      "maxSubDepth": 2,
      "maxSubBreadth": 10
    },
    "truncated": {
      "supers": false,
      "derivedDepth": false,
      "derivedBreadthByClass": {}
    }
  }
}
```

Representative error:
```txt
Angelscript class hierarchy
error: Class not found.
code: NotFound
```

## `angelscript_findReferences`

Purpose:
- Find project references for the symbol at a file position.

Representative input:
```json
{
  "filePath": "G:/Project/Game/Characters/Hero.as",
  "position": {
    "line": 128,
    "character": 17
  },
  "limit": 30
}
```

Representative success `text`:
```txt
Angelscript references
// input: G:/Project/Game/Characters/Hero.as:128:17 | limit=30

// G:/Project/Game/Characters/Hero.as
// range: 128:5-128:17
128:        JumpToTarget(TargetActor);
```

Representative success `json`:
```json
{
  "ok": true,
  "data": {
    "total": 1,
    "returned": 1,
    "limit": 30,
    "truncated": false,
    "references": [
      {
        "filePath": "G:/Project/Game/Characters/Hero.as",
        "startLine": 128,
        "endLine": 128,
        "range": {
          "start": {
            "line": 128,
            "character": 5
          },
          "end": {
            "line": 128,
            "character": 17
          }
        },
        "preview": "        JumpToTarget(TargetActor);"
      }
    ],
    "request": {
      "filePath": "G:/Project/Game/Characters/Hero.as",
      "position": {
        "line": 128,
        "character": 17
      },
      "limit": 30
    }
  }
}
```

Representative truncated success `text`:
```txt
Angelscript references
// input: G:/Project/Game/Characters/Hero.as:128:17 | limit=2
// returned: 2/35 | truncated=true
```

Representative error:
```txt
Angelscript references
error: Invalid params. 'line' and 'character' must be positive integers (1-based).
code: InvalidParams
```

## Maintenance Rules

- Update this document whenever LM tool inputs, defaults, output shape, or formatter-visible text changes.
- Keep examples aligned with current formatter behavior, especially title lines, compact headers, visibility rendering, and preview formatting.
- If a tool contract change also affects generated README LM sections, run `npm run sync:lm-tools`.
- For contract-sensitive changes, run `npm run test:fork-boundary`.
