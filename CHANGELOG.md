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
- All `angelscript_` tools now return qgrep-style plain text only; JSON success/error envelopes are no longer exposed as the public contract.
- VS Code LM tools now return only `LanguageModelTextPart`.
- MCP `tools/call` now returns only text `content`; failures still set `isError`, but no longer expose `structuredContent`.
- Tool text formatting is now unified around `Title + key: value + ==== + ---` and line-based previews use `lineNumber + ':'/'-' + 4 spaces + source text`.
- `angelscript_resolveSymbolAtPosition` preview still checks one line above definition start for Unreal reflection macros (`UCLASS/UPROPERTY/UFUNCTION/UENUM`) and renders that macro line as context when matched.
- `angelscript_findReferences` plain-text output now includes 1-based `range` labels and per-file grouping.
- Added formatter and transport tests to lock the pure-text contract and ensure LM/MCP outputs no longer expose JSON payload parts.
- Updated tool descriptions, schema docs, README, and face-ai report to match the plain-text contract.
- CI release workflow migrated from `beta/release` to `pre-release/release`: now publishes to VS Code Marketplace only (no GitHub release assets), keeps `runs-on: ubuntu-latest`, packages VSIX without platform target, and force-updates branch tags `pre-release`/`release` on successful runs.

#### Breaking Changes
- Callers that assumed output `filePath` is always absolute should migrate to parse both workspace-relative and absolute path formats.
- Any caller that previously parsed JSON from LM/MCP tool results must migrate to plain-text parsing or stop depending on machine-readable payloads.
- Any caller that relied on `LanguageModelDataPart` or MCP `structuredContent` for `angelscript_*` tools must migrate because those channels are no longer emitted.
- Any caller that assumed previous JSON success envelopes or `references[*].range` object parsing must migrate to the new qgrep-style text contract.

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
- 全部 `angelscript_` 工具现在只对外返回 qgrep 风格纯文本,不再暴露 JSON 成功/失败 envelope 作为公共契约.
- VS Code LM tool 现在仅返回 `LanguageModelTextPart`.
- MCP `tools/call` 现在仅返回文本 `content`; 失败时仍保留 `isError`,但不再返回 `structuredContent`.
- 工具文本格式统一为 `标题 + key: value + ==== + ---`,所有行级预览统一使用 `行号 + ':'/'-' + 4 个空格 + 源码`.
- `angelscript_resolveSymbolAtPosition` 的预览仍会检查定义起始行上一行是否为 Unreal 反射宏(`UCLASS/UPROPERTY/UFUNCTION/UENUM`),命中时把宏行作为上下文输出.
- `angelscript_findReferences` 的纯文本输出现在会显示 1-based 的 `range` 标签,并按文件分组展示引用.
- 新增 formatter 与 transport 测试,用于锁定纯文本契约并确保 LM/MCP 不再暴露 JSON payload 通道.
- 已同步更新工具描述、schema 文案、README 与 face-ai report,确保契约一致.
- CI 发布流程从 `beta/release` 迁移到 `pre-release/release`: 仅发布到 VS Code Marketplace(不再发布 GitHub 资产),保持 `runs-on: ubuntu-latest`,VSIX 打包不限定平台,并在成功后强制更新分支同名 tag(`pre-release`/`release`).

#### Breaking Changes
- 如果调用方假设输出 `filePath` 永远是绝对路径,需要迁移为同时兼容工作区路径和绝对路径.
- 任何此前从 LM/MCP 工具结果中解析 JSON 的调用方,都需要迁移为解析纯文本或放弃机器可读依赖.
- 任何依赖 `LanguageModelDataPart` 或 MCP `structuredContent` 获取 `angelscript_*` 工具结果的调用方,都需要迁移,因为这些通道已被移除.
- 任何依赖旧 JSON success envelope 或 `references[*].range` 对象解析的调用方,都需要迁移到新的 qgrep 风格文本契约.

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
- LM tool channels now share consistent string/object output behavior (`string` direct output, object JSON output).

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
- LM tool 通道在输出层统一行为:`string` 直接输出,对象按 JSON 输出.

#### 修复
- 已同步更新工具描述、输入 schema 文案与 README,确保与最新契约一致.

#### Breaking Changes
- 任何传入 `0-based` 行列给 `angelscript_resolveSymbolAtPosition` 或 `angelscript_findReferences` 的调用方,都需要迁移到 `1-based`.
- 任何解析 `angelscript_findReferences` 结构化成功 JSON 的调用方,都需要改为解析预览文本.
- 任何依赖 `angelscript_searchApi.items[].data` 的调用方,都需要移除该依赖.

