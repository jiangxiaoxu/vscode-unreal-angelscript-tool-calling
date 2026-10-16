# Structured Search Matching

Smart search matches code symbols using ordered, continuous substrings. It supports canonical qualified names, short names, and aliases. It does not reorder fragments, skip letters within a fragment, or correct typos.

## Query Syntax

| Syntax | Meaning |
| --- | --- |
| Space | Wildcard gap across any characters; fragments must remain in order. |
| `::` | Namespace or type boundary. |
| `.` | Member boundary; not interchangeable with `::`. |
| Trailing ASCII `;` | End the final fragment at an identifier boundary: before `.`, `::`, or end-of-text, not before identifier continuation such as letters, digits, or `_`. |
| Trailing `(` or `()` | Callable symbols only, filtered before ranking; does not parse arguments or require zero arguments. |

Only trailing ASCII `;`, `(`, and `()` have these suffix meanings. Full-width `；` is ordinary text. Parentheses elsewhere are ordinary text unless the host defines extra rules. The suffixes can combine, for example `OpenPawnDataAIAsset;(`.

## Ranking

Exact and fuzzy matches share one ranked pool. An exact short-name hit does not suppress other qualified-name matches from the same query branch.

The core ranking priorities are:

1. Exact canonical qualified name.
2. Earlier position, smaller total gap, then smaller span in the canonical qualified name.
3. Match reason, then preferred view, as secondary tie-breaks.

Match reasons are `exact-qualified`, `exact-short`, `boundary-ordered`, `ordered-wildcard`, and `short-ordered`. See [api_search.ts](language-server/src/api_search.ts) for the full comparator, including scope and kind tie-breaks.

## Examples

| Query | Candidate | Result |
| --- | --- | --- |
| `gameplayt AI` | `GameplayTags::Status_AI` | Match: ordered wildcard gap. |
| `play tag :: AI` | `GameplayTags::Status_AI` | Match: ordered fragments and namespace boundary. |
| `gameplayt . AI` | `GameplayTags::Status_AI` | No match: wrong boundary. |
| `GameplayCue;` | `GameplayTags::GameplayCue` | Match: identifier ends here. |
| `GameplayCue;` | `GameplayTags::GameplayCue_Test` | No match: `_Test` continues the identifier. |
| `Cthu Extension . DataAIAsset(` | `UCthuAICharacterExtension.OpenPawnDataAIAsset` | Match only if callable. |

Executable examples: [apiSearch.test.ts](language-server/src/__tests__/apiSearch.test.ts) and [apiSearch.realSymbols.test.ts](language-server/src/__tests__/apiSearch.realSymbols.test.ts).
