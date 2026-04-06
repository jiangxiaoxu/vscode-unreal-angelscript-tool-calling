# Agent Instructions

## Version Bump

When asked to bump the version, run this command from the repository root:

```
npm version patch --no-git-tag-version
```

## Tool Output Contract

For implemented `Language Model Tool` tools, responses include:
- human-readable `text`
- structured `json` (optional)

Do not return only one of them.

## Changelog Language

`CHANGELOG.md` entries must be bilingual:
- English
- Chinese

## README Requirements

`README.md` must be bilingual:
- English
- Chinese

`README.md` must include a navigable table of contents with anchor links.

## LM Tool Documentation

Keep LM tool documentation in sync with implementation.

- `README.md` remains the top-level entry for LM tool capabilities and must link to the dedicated LM tool template document.
- `lm-tool-templates.md` stores the maintained input/output templates for implemented LM tools, including:
  - input examples
  - success `text` templates
  - success `json` templates
  - representative error templates
  - shared formatting rules and path/position conventions
- When changing LM tool behavior, update documentation in the same change whenever any of the following change:
  - tool inputs or defaults
  - tool outputs or output mode behavior
  - human-readable `text` formatting
  - structured `json` shape
  - path, range, line, or position conventions
- For contract-sensitive LM tool changes, keep these artifacts aligned together:
  - `scripts/lmToolManifest.mjs`
  - generated `README.md` LM tool blocks via `npm run sync:lm-tools`
  - `lm-tool-templates.md`
- Do not let documentation examples drift from current formatter behavior. If formatter snapshots or tests change, update the templates in the same change.

## Fork Maintenance

Follow these rules to keep the fork mergeable against `upstream/master`:

- Land new fork-only behavior in boundary layers first. Do not move large custom implementations back into `extension/src/extension.ts`, `language-server/src/server.ts`, or `language-server/src/symbols.ts`.
- Treat `extension/src/extension.ts`, `language-server/src/server.ts`, and `language-server/src/symbols.ts` as upstream-sensitive entrypoints. Only add small bugfixes, thin glue, or unavoidable registration/wiring.
- Treat `extension/src/apiRequests.ts` and public `angelscript_*` tool contracts as additive-only by default. Do not rename/remove public fields or flip default path/index/output semantics in place.
- Do not edit parser/database/core files for fork-only features by default. This includes files such as `language-server/src/as_parser.ts`, `language-server/src/database.ts`, `language-server/src/parsed_completion.ts`, and `language-server/src/references.ts`.
- Keep fork-only commits focused on one dimension only: contract, formatter, transport, search behavior, docs, or CI.
- Prefer fork-only commit prefixes such as `fork(tooling):`, `fork(contract):`, `fork(release):`, or `fork(docs):`.
- Run `npm run test:fork-boundary` before contract-sensitive changes or upstream merge work.
- Run `npm run merge:smoke -- --base upstream/master` before preparing an upstream merge.
