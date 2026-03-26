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

## Fork Maintenance

This repository follows a layered-compatibility strategy to reduce long-term merge cost against `upstream/master`.

- Prefer landing fork-only behavior in boundary layers such as `extension/src/toolRegistry.ts`, `extension/src/toolShared.ts`, `extension/src/toolTextFormatter.ts`, `extension/src/toolResultTransport.ts`, and `language-server/src/api_search.ts`.
- Treat `extension/src/extension.ts`, `language-server/src/server.ts`, and `language-server/src/symbols.ts` as upstream-sensitive entrypoints. Only change them for small bugfixes or unavoidable integration work.
- Evolve public `angelscript_*` tool contracts additively by default. Do not rename or remove public fields, flip default path/index semantics, or replace structured/text output behavior in place unless there is an explicit opt-in path.
- Keep commits focused on one dimension only: contract, formatter, transport, search behavior, docs, or CI. Do not mix behavior changes with docs/release/workflow churn in the same commit.
- For fork-only commits, prefer prefixes such as `fork(tooling):`, `fork(contract):`, `fork(release):`, or `fork(docs):`.
- Before upstream merge work or contract-sensitive changes, run `npm run test:fork-boundary`. For maintenance checks, use `npm run upstream:divergence:stat`, `npm run upstream:divergence:log`, and `npm run merge:smoke -- --base upstream/master`.
