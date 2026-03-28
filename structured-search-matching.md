# Structured Search Matching

## Summary

This document describes a reusable structured fuzzy search model for code symbols.

The model is designed for symbol search rather than free-form text search:
- preserve fragment order
- require each fragment to match a continuous substring
- keep separator semantics explicit
- expose a small set of match reasons for AI and UI consumers

## Query Syntax

Smart queries recognize four constructs:

- `space`
  - Acts as an ordered wildcard gap.
  - The fragments on both sides must still appear in real order.
- `::`
  - Requires a namespace or type boundary.
- `.`
  - Requires a member boundary.
- trailing `(` or `()`
  - Means callable-only.
  - Restricts matches to callable symbols such as methods and functions.
  - Does not match argument lists.
  - Does not mean "zero arguments".

Only the trailing `(` / `()` form is special. Parentheses in other positions are treated as ordinary text unless the host project defines extra rules.

## Matching Rules

Given a parsed query and a candidate symbol view:

1. Split the query into ordered fragments plus connectors.
2. Match each fragment as a continuous substring.
3. Keep fragment order stable across the candidate text.
4. Let `space` cross any characters.
5. Require `::` to cross a namespace/type boundary.
6. Require `.` to cross a member boundary.
7. If trailing `(` or `()` is present, filter results to callable kinds before ranking.

The same query can be evaluated against multiple views, for example:
- canonical qualified name
- short name
- alias or alternate qualified view

## Ranking

Recommended match reasons:

- `exact-qualified`
- `exact-short`
- `boundary-ordered`
- `ordered-wildcard`
- `short-ordered`

For smart search, exact and fuzzy matches share one ranked pool. Exact short-name hits should not suppress other qualified-name matches from the same query branch.

Recommended sort order inside one result set:

1. Exact canonical qualified-name matches
2. Earlier match position in the canonical qualified name
3. Smaller total gap in the canonical qualified name
4. Smaller canonical qualified-name span
5. Higher-priority match reason as a secondary tie-break
6. Preferred view priority

## Examples

Candidate:

`GameplayTags::Status_AI`

Queries:

- `gameplayt`
- `gameplayt AI`
- `gameplayt :: AI`
- `play tag :: AI`

These should match.

`gameplayt . AI` should not match because `.` and `::` are not interchangeable.

Candidate:

`UCthuAICharacterExtension.OpenPawnDataAIAsset`

Queries:

- `OpenPawnDataAIAsset(`
- `OpenPawnDataAIAsset()`
- `Cthu Extension . DataAIAsset(`
- `Cthu Extension DataAIAsset(`

These should match callable symbols only.

## Non-Goals

This model intentionally does not require:

- arbitrary token reordering
- skip-letter subsequence fuzzy matching
- typo-distance matching
- argument-list parsing from `()`
