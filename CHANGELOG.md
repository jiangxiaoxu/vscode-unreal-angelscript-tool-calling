# Changelog

All notable changes to this extension are documented in this file.

Maintenance rule:
- For each release, keep both `### English` and `### 中文` sections.
- Keep section order aligned to reduce translation drift.

## [Unreleased]

### English

#### Changed
- `angelscript_searchApi` and `GetAPISearch` now treat omitted `includeInheritedFromScope` as auto-on only for resolved class scopes, keep namespace/struct/enum or unresolved scopes silent, and add tool-layer request metadata for resolved inheritance mode/value.
- `angelscript_getTypeMembers` now always returns the target type description as `type.description`, keeps member descriptions gated by `includeDocs=true`, and renders human-readable text as Angelscript-style declarations with comment-based docs/origin notes.
- Activation strategy now includes `onLanguage:angelscript` and `workspaceContains:**/*.as`, keeps all `onLanguageModelTool:*`, and removes `onDebug` to avoid unrelated startup.
- Startup indexing now resolves only supported Script roots (workspace root is `Script`, or contains `<workspace>/Script`) and scans `Script/**/*.as` only; unsupported layouts now fail fast with an explicit error and skip initial indexing.
- Language client now passes `scriptIgnorePatterns` in `initializationOptions`, so initial glob scanning applies ignore rules immediately.
- Runtime watched-file notifications and text-document incremental updates are now hard-limited to resolved Script roots as well.
- Removed built-in default ignore patterns for script scanning; `UnrealAngelscript.scriptIgnorePatterns` now defaults to an empty list.
- `Angelscript API` views now use `when: unrealAngelscript.apiPanelEnabled`; the activity entry stays hidden until the extension is actually activated.
- `angelscript_resolveSymbolAtPosition` and `angelscript_findReferences` now require absolute `filePath` input, and LM tool outputs now normalize `filePath` to absolute-path form only.
- `angelscript_findReferences` now accepts optional `limit` (default `30`, max `200`) and returns `total`, `returned`, `limit`, and `truncated` in structured output while surfacing truncation notices in text output.
- `angelscript_getClassHierarchy` now degrades unresolved script preview paths to `<source unavailable>` instead of failing the entire tool with `InvalidParams`.
- `angelscript_searchApi` now splits its search contract by caller: the Angelscript API panel keeps smart search, while the LM tool uses `query` plus optional `limit`, `source`, `scope`, `includeInheritedFromScope`, `includeDocs`, and `regex`.
- `angelscript_searchApi` now returns `matches`, optional `notices`, optional `scopeLookup`, and tool-layer `request`.
- Search execution moved into a dedicated language-server index with smart/plain/regex matching, ordered token-gap plain matching, weak token reorder fallback, namespace/type scoping, inherited member expansion, and nearest-override dedupe.
- The API panel search path now consumes the new `angelscript/getAPISearch` result directly instead of applying client-side pagination, regex, and secondary sorting.
- VS Code LM tools now default to `text-only`; `LanguageModelDataPart.json(...)` is included only when `UnrealAngelscript.languageModelTools.outputMode=text+structured`.
- This repository no longer carries MCP server/runtime transport helpers or MCP-specific test/doc promises.
- LM tool success text now defaults to a code-first style: stable title line, declaration/snippet-first bodies, normalized `/** ... */` docs, `// ...` metadata comments, and line-based previews using `lineNumber + ':'/'-' + 4 spaces + source text`.
- `angelscript_searchApi`, `angelscript_resolveSymbolAtPosition`, `angelscript_getClassHierarchy`, and `angelscript_findReferences` human-readable success text now render as code-like declarations/snippets instead of qgrep-style `key: value` sections.
- `angelscript_resolveSymbolAtPosition` preview still checks one line above definition start for Unreal reflection macros (`UCLASS/UPROPERTY/UFUNCTION/UENUM`) and renders that macro line as context when matched.
- `angelscript_findReferences` plain-text output now includes 1-based `range` labels and per-file grouping.
- Added language-server search behavior tests plus refreshed formatter/transport tests for LM `text+structured` and `text-only`.
- Updated tool descriptions, schema docs, README, and face-ai report to match the split panel-smart and LM-plain search contract.
- CI release workflow migrated from `beta/release` to `pre-release/release`: now publishes to VS Code Marketplace only (no GitHub release assets), keeps `runs-on: ubuntu-latest`, packages VSIX without platform target, and force-updates branch tags `pre-release`/`release` on successful runs.

#### Breaking Changes
- `angelscript_searchApi` and `GetAPISearch` now use a new default for omitted `includeInheritedFromScope`: resolved class scopes auto-expand inherited methods/properties instead of behaving like hard `false`.
- Any caller sending workspace-relative `filePath` to `angelscript_resolveSymbolAtPosition` or `angelscript_findReferences` must migrate to absolute paths.
- Any caller using the old `angelscript_searchApi` parameters (`labelQuery`, `searchIndex`, `maxBatchResults`, `includeDocs`, `labelQueryUseRegex`, `signatureRegex`) must migrate to the new search contract.
- Any caller depending on in-repo MCP server/runtime helpers must remove that dependency because this repository now exposes only VS Code LM tools.
- Any caller consuming LM tool output should treat `text-only` as the default response and opt into `UnrealAngelscript.languageModelTools.outputMode=text+structured` when structured JSON is required.

### 中文

#### 变更
- `angelscript_searchApi` 与 `GetAPISearch` 现在会把省略的 `includeInheritedFromScope` 解释为仅在解析到 class scope 时自动开启,对 namespace/struct/enum 或未解析 scope 保持静默关闭,并在 tool 层 `request` 中补充解析后的继承模式和值.
- `angelscript_getTypeMembers` 现在始终通过 `type.description` 返回目标类型自身描述,成员描述仍仅在 `includeDocs=true` 时返回,且可读文本会改为更接近 Angelscript 的声明式输出,通过注释补充文档和来源信息.
- 激活策略新增 `onLanguage:angelscript` 与 `workspaceContains:**/*.as`, 保留全部 `onLanguageModelTool:*`, 并移除 `onDebug` 以避免无关场景启动.
- 启动索引改为仅解析受支持的 Script 根目录(工作区根为 `Script` 或包含 `<workspace>/Script`)并仅扫描 `Script/**/*.as`; 对不受支持的工作区形态会明确报错并跳过初始索引.
- Language client 现在会在 `initializationOptions` 中下发 `scriptIgnorePatterns`,使首次 glob 扫描即可应用忽略规则.
- 运行期 watched-file 通知与文本增量更新处理也已硬限制为仅处理解析后的 Script 根目录.
- 已移除脚本扫描的内置默认忽略规则; `UnrealAngelscript.scriptIgnorePatterns` 默认值改为空数组.
- `Angelscript API` 视图新增 `when: unrealAngelscript.apiPanelEnabled`, 扩展未激活时隐藏对应 activity 入口, 激活后再显示.
- `angelscript_resolveSymbolAtPosition` 与 `angelscript_findReferences` 现在要求传入绝对路径 `filePath`,LM tool 输出中的 `filePath` 也统一规范为绝对路径格式.
- `angelscript_findReferences` 现在支持可选 `limit` 参数(默认 `30`,最大 `200`),结构化输出新增 `total`、`returned`、`limit`、`truncated`,文本输出会明确提示结果是否被截断.
- `angelscript_getClassHierarchy` 现在在脚本类预览路径无法解析时会降级为 `<source unavailable>`,而不是让整个工具以 `InvalidParams` 失败.
- `angelscript_searchApi` 现在按调用方拆分搜索契约: Angelscript API 面板继续使用 smart search, LM tool 改为使用 `query` 和可选 `limit`、`source`、`scope`、`includeInheritedFromScope`、`includeDocs`、`regex`.
- `angelscript_searchApi` 现在返回 `matches`、可选 `notices`、可选 `scopeLookup`,并在 tool 层附加 `request`.
- 搜索执行已下沉到独立的 language-server 索引,支持 smart/plain/regex、ordered token gap plain 匹配、weak token reorder 回退、namespace/type scope、继承成员扩展与最近 override 去重.
- API 面板搜索路径现在直接消费新的 `angelscript/getAPISearch` 结果,不再在 extension 侧做分页、正则和二次排序.
- VS Code LM tool 现在默认返回 `text-only`; 只有在 `UnrealAngelscript.languageModelTools.outputMode=text+structured` 时才会附带 `LanguageModelDataPart.json(...)`.
- 当前仓库已不再保留 MCP server/runtime transport helper 和 MCP 专属测试/文档承诺.
- LM tool 的成功文本现在默认采用 code-first 风格: 保留稳定标题行,主体优先输出声明式文本或源码片段,文档统一归一化为 `/** ... */`,元信息统一用 `// ...` 注释表达,所有行级预览继续使用 `行号 + ':'/'-' + 4 个空格 + 源码`.
- `angelscript_searchApi`、`angelscript_resolveSymbolAtPosition`、`angelscript_getClassHierarchy`、`angelscript_findReferences` 的可读成功文本现已改为更像代码的声明/片段输出,不再默认使用 qgrep 风格的 `key: value` 分段摘要.
- `angelscript_resolveSymbolAtPosition` 的预览仍会检查定义起始行上一行是否为 Unreal 反射宏(`UCLASS/UPROPERTY/UFUNCTION/UENUM`),命中时把宏行作为上下文输出.
- `angelscript_findReferences` 的纯文本输出现在会显示 1-based 的 `range` 标签,并按文件分组展示引用.
- 新增 language-server 搜索行为测试,并更新 formatter/transport 测试以覆盖 LM `text+structured` 与 `text-only`.
- 已同步更新工具描述、schema 文案、README 与 face-ai report,确保面板 smart search 与 LM plain search 的拆分契约一致.
- CI 发布流程从 `beta/release` 迁移到 `pre-release/release`: 仅发布到 VS Code Marketplace(不再发布 GitHub 资产),保持 `runs-on: ubuntu-latest`,VSIX 打包不限定平台,并在成功后强制更新分支同名 tag(`pre-release`/`release`).

#### Breaking Changes
- `angelscript_searchApi` 与 `GetAPISearch` 现在对省略的 `includeInheritedFromScope` 使用新的默认语义: 解析到 class scope 时会自动展开 inherited method/property,不再等同于硬编码 `false`.
- 任何向 `angelscript_resolveSymbolAtPosition` 或 `angelscript_findReferences` 传入工作区相对 `filePath` 的调用方,都需要迁移为传入绝对路径.
- 任何仍在使用旧 `angelscript_searchApi` 参数(`labelQuery`、`searchIndex`、`maxBatchResults`、`includeDocs`、`labelQueryUseRegex`、`signatureRegex`)的调用方,都需要迁移到新搜索契约.
- 任何依赖仓库内 MCP server/runtime helper 的调用方,都需要移除这层依赖,因为当前仓库只暴露 VS Code LM tools.
- 任何消费 LM tool 输出的调用方,都需要按默认 `text-only` 响应适配; 只有在确实需要结构化 JSON 时再显式设置 `UnrealAngelscript.languageModelTools.outputMode=text+structured`.

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

