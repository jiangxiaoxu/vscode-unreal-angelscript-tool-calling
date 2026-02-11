# Changelog

All notable changes to this extension are documented in this file.

Maintenance rule:
- For each release, keep both `### English` and `### 中文` sections.
- Keep section order aligned to reduce translation drift.

## [Unreleased]

### English

#### Changed
- Activation strategy now includes `onLanguage:angelscript` and `workspaceContains:**/*.as`, keeps all `onLanguageModelTool:*`, and removes `onDebug` to avoid unrelated startup.
- Startup indexing now resolves only supported Script roots (workspace root is `Script`, or contains `<workspace>/Script`) and scans `Script/**/*.as` only; unsupported layouts now fail fast with an explicit error and skip initial indexing.
- Language client now passes `scriptIgnorePatterns` in `initializationOptions`, so initial glob scanning applies ignore rules immediately.
- Runtime watched-file notifications and text-document incremental updates are now hard-limited to resolved Script roots as well.
- Removed built-in default ignore patterns for script scanning; `UnrealAngelscript.scriptIgnorePatterns` now defaults to an empty list.
- `Angelscript API` views now use `when: unrealAngelscript.apiPanelEnabled`; the activity entry stays hidden until the extension is actually activated.
- `angelscript_resolveSymbolAtPosition` and `angelscript_findReferences` now accept `filePath` as either absolute path or workspace-relative path (prefer `<workspaceFolderName>/...`).
- Path output now prefers workspace-relative format with root prefix (for example `CthulhuGame/Source/...`), and falls back to absolute path only when the file is outside all workspace folders.
- Multi-root path resolution now detects ambiguity for relative `filePath` and returns `InvalidParams` with candidate paths instead of silently picking one root.
- All `angelscript_` tools now use a unified success envelope: `{ ok:true, data: ... }`; failures remain `{ ok:false, error:{ ... } }`.
- `angelscript_resolveSymbolAtPosition` and `angelscript_findReferences` success responses are now structured JSON again (no longer plain preview text).
- `angelscript_findReferences` now returns `range` together with `preview`; all `range.start/end.line/character` values are 1-based in tool output.
- Line-based outputs now include `preview` fields to provide source snippets directly:
  - `resolve`: `data.symbol.definition.preview`
  - `findReferences`: `data.references[*].preview`
  - `getClassHierarchy`: `data.sourceByClass[*].preview` when `source="as"`
- `angelscript_resolveSymbolAtPosition` preview checks one line above definition start for Unreal reflection macros (`UCLASS/UPROPERTY/UFUNCTION/UENUM`) and uses that macro line as snippet start when matched.
- Updated tool descriptions, schema docs, README, and face-ai report to match the unified JSON contract.
- VS Code LM tool results now return dual content parts: `LanguageModelDataPart.json(payload)` for machine-readable JSON and `LanguageModelTextPart` with human-readable multi-line text.
- MCP `tools/call` responses now include both `structuredContent` (payload object) and human-readable text `content`, plus `isError` when `payload.ok === false`.
- CI release workflow migrated from `beta/release` to `pre-release/release`: now publishes to VS Code Marketplace only (no GitHub release assets), keeps `runs-on: ubuntu-latest`, packages VSIX without platform target, and force-updates branch tags `pre-release`/`release` on successful runs.

#### Breaking Changes
- Callers that assumed output `filePath` is always absolute should migrate to parse both workspace-relative and absolute path formats.
- Callers of `angelscript_searchApi`, `angelscript_getTypeMembers`, and `angelscript_getClassHierarchy` must read success payload under `data` (instead of previous top-level success fields).
- Any caller parsing plain-text success output from `angelscript_resolveSymbolAtPosition` or `angelscript_findReferences` must migrate to JSON parsing.
- Any caller that previously interpreted `angelscript_findReferences.data.references[*].range` as raw LSP 0-based offsets must migrate to 1-based indices.
- Any caller that parsed LM/MCP text channels (`LanguageModelTextPart` or MCP `content.text`) as raw JSON must migrate to `structuredContent` for machine parsing.

### 中文

#### 变更
- 激活策略新增 `onLanguage:angelscript` 与 `workspaceContains:**/*.as`, 保留全部 `onLanguageModelTool:*`, 并移除 `onDebug` 以避免无关场景启动.
- 启动索引改为仅解析受支持的 Script 根目录(工作区根为 `Script` 或包含 `<workspace>/Script`)并仅扫描 `Script/**/*.as`; 对不受支持的工作区形态会明确报错并跳过初始索引.
- Language client 现在会在 `initializationOptions` 中下发 `scriptIgnorePatterns`,使首次 glob 扫描即可应用忽略规则.
- 运行期 watched-file 通知与文本增量更新处理也已硬限制为仅处理解析后的 Script 根目录.
- 已移除脚本扫描的内置默认忽略规则; `UnrealAngelscript.scriptIgnorePatterns` 默认值改为空数组.
- `Angelscript API` 视图新增 `when: unrealAngelscript.apiPanelEnabled`, 扩展未激活时隐藏对应 activity 入口, 激活后再显示.
- `angelscript_resolveSymbolAtPosition` 与 `angelscript_findReferences` 的 `filePath` 输入支持绝对路径和工作区路径(建议 `<workspaceFolderName>/...`).
- 路径输出改为优先使用带 root 名的工作区路径(例如 `CthulhuGame/Source/...`),仅当文件不在任何工作区时才回退为绝对路径.
- 多工作区下,相对 `filePath` 若存在歧义会返回带候选路径的 `InvalidParams`,不再静默选择某个 root.
- 全部 `angelscript_` 工具的成功返回统一为 `{ ok:true, data: ... }`,失败保持 `{ ok:false, error:{ ... } }`.
- `angelscript_resolveSymbolAtPosition` 与 `angelscript_findReferences` 成功返回改回结构化 JSON,不再返回纯文本预览.
- `angelscript_findReferences` 现在会同时返回 `range` 和 `preview`; 工具输出中的 `range.start/end.line/character` 全部为 1-based.
- 所有行级定位结果统一补充 `preview` 字段用于直接返回源码片段:
  - `resolve`: `data.symbol.definition.preview`
  - `findReferences`: `data.references[*].preview`
  - `getClassHierarchy`: `data.sourceByClass[*].preview`(仅 `source="as"`)
- `angelscript_resolveSymbolAtPosition` 的 `preview` 仍会检查定义起始行上一行是否为 Unreal 反射宏(`UCLASS/UPROPERTY/UFUNCTION/UENUM`),命中时使用该宏行作为片段起始行.
- 已同步更新工具描述、schema 文案、README 与 face-ai report,确保契约一致.
- VS Code LM tool 结果现在返回双通道: `LanguageModelDataPart.json(payload)` 提供 machine-readable JSON,`LanguageModelTextPart` 提供 human-readable 多行文本.
- MCP `tools/call` 响应现在同时包含 `structuredContent`(payload 对象) 与 human-readable 文本 `content`,并在 `payload.ok === false` 时设置 `isError`.
- CI 发布流程从 `beta/release` 迁移到 `pre-release/release`: 仅发布到 VS Code Marketplace(不再发布 GitHub 资产),保持 `runs-on: ubuntu-latest`,VSIX 打包不限定平台,并在成功后强制更新分支同名 tag(`pre-release`/`release`).

#### Breaking Changes
- 如果调用方假设输出 `filePath` 永远是绝对路径,需要迁移为同时兼容工作区路径和绝对路径.
- `angelscript_searchApi`、`angelscript_getTypeMembers`、`angelscript_getClassHierarchy` 的成功数据读取路径需要迁移到 `data` 字段下.
- 如果调用方此前解析 `angelscript_resolveSymbolAtPosition` 或 `angelscript_findReferences` 的纯文本成功输出,需要迁移为解析 JSON.
- 如果调用方此前把 `angelscript_findReferences.data.references[*].range` 当作 LSP 原始 0-based 偏移,需要迁移为 1-based 索引.
- 如果调用方此前把 LM/MCP 文本通道(`LanguageModelTextPart` 或 MCP `content.text`)当作原始 JSON 解析,需要迁移为读取 `structuredContent`.

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

