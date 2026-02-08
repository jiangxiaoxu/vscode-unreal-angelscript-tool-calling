# Changelog

All notable changes to this extension are documented in this file.

Maintenance rule:
- For each release, keep both `### English` and `### 中文` sections.
- Keep section order aligned to reduce translation drift.

## [Unreleased]

### English

#### Changed
- `angelscript_resolveSymbolAtPosition` and `angelscript_findReferences` now accept `filePath` as either absolute path or workspace-relative path (prefer `<workspaceFolderName>/...`).
- Path output now prefers workspace-relative format with root prefix (for example `CthulhuGame/Source/...`), and falls back to absolute path only when the file is outside all workspace folders.
- Multi-root path resolution now detects ambiguity for relative `filePath` and returns `InvalidParams` with candidate paths instead of silently picking one root.
- `angelscript_getClassHierarchy` `sourceByClass[*].filePath` now follows the same workspace-relative-first output rule.
- `angelscript_resolveSymbolAtPosition` success output now returns preview text instead of structured success JSON. The preview includes `kind/name/signature`, definition header, optional doc block, and snippet.
- `angelscript_resolveSymbolAtPosition` preview now checks one line above definition start for Unreal reflection macros (`UCLASS/UPROPERTY/UFUNCTION/UENUM`) and uses that macro line as snippet start when matched.
- Updated tool descriptions, schema docs, and README to match the new path contract.

#### Breaking Changes
- Callers that assumed output `filePath` is always absolute should migrate to parse both workspace-relative and absolute path formats.
- Any caller parsing structured success JSON from `angelscript_resolveSymbolAtPosition` must migrate to preview text parsing.

### 中文

#### 变更
- `angelscript_resolveSymbolAtPosition` 与 `angelscript_findReferences` 的 `filePath` 输入支持绝对路径和工作区路径(建议 `<workspaceFolderName>/...`).
- 路径输出改为优先使用带 root 名的工作区路径(例如 `CthulhuGame/Source/...`),仅当文件不在任何工作区时才回退为绝对路径.
- 多工作区下,相对 `filePath` 若存在歧义会返回带候选路径的 `InvalidParams`,不再静默选择某个 root.
- `angelscript_getClassHierarchy` 的 `sourceByClass[*].filePath` 也统一为工作区路径优先规则.
- `angelscript_resolveSymbolAtPosition` 成功输出改为预览文本,不再返回结构化成功 JSON. 预览包含 `kind/name/signature`、定义头、可选文档块与代码片段.
- `angelscript_resolveSymbolAtPosition` 预览会检查定义起始行上一行是否为 Unreal 反射宏(`UCLASS/UPROPERTY/UFUNCTION/UENUM`),命中时使用该宏行作为片段起始行.
- 已同步更新工具描述、schema 文案与 README,确保契约一致.

#### Breaking Changes
- 如果调用方假设输出 `filePath` 永远是绝对路径,需要迁移为同时兼容工作区路径和绝对路径.
- 如果调用方解析 `angelscript_resolveSymbolAtPosition` 结构化成功 JSON,需要迁移为解析预览文本.

## [1.8.8035] - 2026-02-06

### English

#### Changed
- Added startup conflict detection for `Hazelight.unreal-angelscript`.
- On every startup, when the conflicting extension is detected, this extension now shows an uninstall prompt and skips initialization.
- Updated README compatibility notes to document this behavior.

### 中文

#### 变更
- 新增对 `Hazelight.unreal-angelscript` 的启动冲突检测.
- 每次启动时,如果检测到冲突扩展,本扩展会弹窗提示卸载并跳过初始化.
- 已在 README 中补充该兼容性说明.

## [1.8.8033] - 2026-02-06

### English

#### Changed
- `angelscript_resolveSymbolAtPosition` input `position.line/character` is now `1-based` (was `0-based`).
- `angelscript_resolveSymbolAtPosition` output `definition.startLine/endLine` is now `1-based`.
- `angelscript_findReferences` input `position.line/character` is now `1-based` (was `0-based`).
- `angelscript_findReferences` success output now returns preview text (not structured `references` JSON).
- `angelscript_findReferences` preview supports multi-line snippets, uses `---` between results, and limits each result to 20 lines.
- `angelscript_searchApi` result `items[]` no longer includes `data` in tool output, keeping only `signature/docs/type`.
- LM tools and MCP tools now share consistent string/object output behavior (`string` direct output, object JSON output).

#### Fixed
- Updated tool descriptions, input schema docs, and README to match the latest tool contracts.

#### Breaking Changes
- Any caller sending `0-based` line/character to `angelscript_resolveSymbolAtPosition` or `angelscript_findReferences` must migrate to `1-based`.
- Any caller parsing structured success JSON from `angelscript_findReferences` must migrate to preview text parsing.
- Any caller relying on `angelscript_searchApi.items[].data` must remove that dependency.

### 中文

#### 变更
- `angelscript_resolveSymbolAtPosition` 的输入 `position.line/character` 改为 `1-based`(原为 `0-based`).
- `angelscript_resolveSymbolAtPosition` 输出 `definition.startLine/endLine` 改为 `1-based`.
- `angelscript_findReferences` 的输入 `position.line/character` 改为 `1-based`(原为 `0-based`).
- `angelscript_findReferences` 成功输出改为预览文本,不再返回结构化 `references` JSON.
- `angelscript_findReferences` 预览支持多行片段,结果间使用 `---` 分隔,每条结果最多 20 行.
- `angelscript_searchApi` 的 `items[]` 对外不再返回 `data`,仅保留 `signature/docs/type`.
- LM tools 与 MCP tools 在输出层统一行为:`string` 直接输出,对象按 JSON 输出.

#### 修复
- 已同步更新工具描述、输入 schema 文案与 README,确保与最新契约一致.

#### Breaking Changes
- 任何传入 `0-based` 行列给 `angelscript_resolveSymbolAtPosition` 或 `angelscript_findReferences` 的调用方,都需要迁移到 `1-based`.
- 任何解析 `angelscript_findReferences` 结构化成功 JSON 的调用方,都需要改为解析预览文本.
- 任何依赖 `angelscript_searchApi.items[].data` 的调用方,都需要移除该依赖.

