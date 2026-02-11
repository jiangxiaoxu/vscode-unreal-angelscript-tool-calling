# Agent Instructions

## Version Bump

When asked to bump the version, run this command from the repository root:

```
npm version patch --no-git-tag-version
```

## Tool Output Contract

For implemented `Language Model Tool` and `MCP` tools, responses must include both:
- human-readable `text`
- structured `json`

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
