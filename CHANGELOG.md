# Changelog

All notable changes to this extension are documented in this file.

Maintenance rule:
- For each release, keep both `### English` and `### 中文` sections.
- Keep section order aligned to reduce translation drift.

## [Unreleased]

### English

#### Changed
- Full project-daemon snapshot validation now recognizes `.as` extensions case-insensitively on Windows, so manifests containing files such as `Uppercase.AS` are accepted when their raw-byte hashes match.
- Added a project-daemon-only sequence-aware script snapshot protocol with verified raw-byte manifests, cancellable semantic waiters, and provenance-bearing API and diagnostics reads. Concurrent daemon clients now wait for the minimum admitted script sequence without polling readiness or invalidating coherent in-flight snapshots when later edits arrive.
- Bounded Language Server responsiveness with 2s Unreal reconnect and API-ready waits, 2s Windows owner queries, a 250ms verified DebugDatabase request delay, a 5s initial no-TypeDB classification, a 4s diagnostics settle deadline, and a 1s shutdown flush. API and diagnostics waits now honor cancellation, while Windows verification uses a fast socket-first query without weakening owner/project validation.
- Replaced the prior roles with `vscode` and `project-daemon` while preserving stdio and IPC transports. Both roles maintain the Unreal connection and publish independent v2 caches at fixed VS Code and Saved paths.
- VS Code now resolves one exact physical `.uproject` before enabling cache I/O. Windows TCP connections validate the same listener owner and project command line before and after connect.
- Platforms without strict listener-owner verification now fail closed for live TCP refresh instead of accepting a blind port connection.
- The project-daemon child now watches `initialize.processId` and stdio EOF so daemon failure cannot leave an orphan Language Server.
- Added readiness status, standard `textDocument/diagnostic` and `workspace/diagnostic` pull support with unchanged reports, full-ready API request gating, and bounded shutdown cleanup.
- Readiness now fences script reloads with monotonic active and settled semantic generations, so stdio clients can reject requests that cross a parse or resolve generation without relying on notification ordering.
- Complete native generations now become the active in-memory TypeDB before asynchronous cache publication. The single writer keeps only the latest immutable snapshot, retries after 1s/3s/5s, preserves the prior final cache on failure or supersession, and exposes active versus persisted revisions and dirty/error state.
- Cache preparation now runs in a worker thread, and each same-socket `DebugDatabaseSettings` marker starts a generation-fenced refresh whose script diagnostics must settle before full readiness.
- Removed API query index publication, export requests, workers, and the standalone index bundle. API requests use the live in-memory TypeDB.
- Removed the VS Code LM tool integration and implementation. The reusable language-server API query core remains available through dedicated request handlers.
- Removed the lookup-time fallback retry for local `auto` variable inference. `auto` member access now relies on declaration-time synchronization of the resolved initializer type into the local variable model.
- VS Code Marketplace pre-release publication now packages the VSIX with `vsce package --pre-release` on the `pre-release` branch before publishing, so package metadata stays aligned with the marketplace channel.
- Activation now uses `onLanguage:angelscript` and `workspaceContains:**/*.as`, and no longer uses `onDebug`.
- Startup indexing now resolves only supported Script roots (workspace root is `Script`, or contains `<workspace>/Script`) and scans `Script/**/*.as` only; unsupported layouts fail fast and skip initial indexing.
- The language client now passes `scriptIgnorePatterns` in `initializationOptions`, and runtime watched-file notifications plus incremental updates are limited to resolved Script roots.
- Removed built-in default ignore patterns for script scanning; `UnrealAngelscript.scriptIgnorePatterns` now defaults to an empty list.
- `Angelscript API` views now use `when: unrealAngelscript.apiPanelEnabled`; the activity entry stays hidden until the extension activates.
- Added structured language-server API query handlers for search, exact symbol lookup, owner members, and class hierarchy. The query core supports source/kind/visibility filtering, deterministic dedupe and sorting, offset paging, ambiguity reporting, constructors, accessors, inherited members, and mixins.
- `GetAPISearch` now treats omitted `includeInheritedFromScope` as auto-on only for resolved class scopes and keeps namespace/struct/enum or unresolved scopes silent.
- Search execution now uses a dedicated language-server index with smart/regex matching, ordered token-gap search, namespace/type scoping, inherited member expansion, nearest-override dedupe, and offset paging.
- The API panel consumes the `angelscript/getAPISearch` result directly instead of applying client-side pagination, regex, and secondary sorting.
- CI release workflow migrated from `beta/release` to `pre-release/release`: it publishes only to VS Code Marketplace, packages VSIX without a platform target, and force-updates the `pre-release`/`release` branch tags after successful runs.

#### Breaking Changes
- The v1 `.vscode/angelscript/unreal-cache.json` cache is no longer read or migrated. Integrations must pass typed initialization options and use the role-owned v2 cache contract.
- Removed the `ue-resident` and `cli-direct` roles and the API query index contract without compatibility aliases.
- VS Code LM tool integration and implementation were removed without a compatibility layer.
- The old `angelscript/getTypeMembers` and `angelscript/getTypeHierarchy` request handlers were replaced by `angelscript/getAPISymbolMembers` and `angelscript/getAPIClassHierarchy`.
- `GetAPISearch` now auto-expands inherited methods/properties when `includeInheritedFromScope` is omitted for a resolved class scope.

### 中文

#### 变更
- Windows 上的 full project-daemon snapshot validation 现在以大小写无关方式识别 `.as` 扩展名. 当 raw-byte hash 匹配时,包含 `Uppercase.AS` 等文件的 manifest 会被接受.
- 新增仅供 project-daemon 使用的 sequence-aware script snapshot protocol,包含 raw-byte manifest 校验、可取消的 semantic waiter,以及携带 provenance 的 API 与 diagnostics read. 并发 daemon client 现在会等待 admission 时要求的最小 script sequence,不再轮询 readiness;后续编辑也不会使已在执行的一致 snapshot 失效.
- Language Server responsiveness 现在受明确上限约束:Unreal reconnect 与 API-ready wait 为 2s,Windows owner query 为 2s,verified DebugDatabase request delay 为 250ms,initial no-TypeDB classification 为 5s,diagnostics settle deadline 为 4s,shutdown flush 为 1s. API 与 diagnostics wait 现在响应 cancellation;Windows verification 改用快速 socket-first query,不放宽 owner/project validation.
- 旧 roles 已替换为 `vscode` 和 `project-daemon`,同时保留 stdio 与 IPC transports. 两种 role 都维持 Unreal connection,并在固定的 VS Code 与 Saved 路径发布独立 v2 cache.
- VS Code 只有解析到唯一 exact physical `.uproject` 后才启用 cache I/O. Windows TCP connection 会在 connect 前后验证同一个 listener owner 与项目 command line.
- 无 strict listener-owner verification 的平台现在会拒绝 live TCP refresh,不再接受未经验证的 port connection.
- Project-daemon child 现在监听 `initialize.processId` 和 stdio EOF,daemon 异常退出时不会留下 orphan Language Server.
- 新增 readiness status、支持 unchanged report 的标准 `textDocument/diagnostic` 与 `workspace/diagnostic` pull、full-ready API request gate 和 bounded shutdown cleanup.
- Readiness 现在使用单调递增的 active/settled semantic generations 隔离 script reload,stdio client 无需依赖 notification 顺序即可拒绝跨 parse 或 resolve generation 的 request.
- 完整 native generation 现在会先成为 active in-memory TypeDB,再异步发布 cache. Single writer 只保留 latest immutable snapshot,按 1s/3s/5s 重试,在失败或 supersede 时保留旧 final cache,并公开 active/persisted revision 与 dirty/error state.
- Cache preparation 现在在 worker thread 中执行;同一 socket 上每个 `DebugDatabaseSettings` marker 都会启动 generation-fenced refresh,script diagnostics settle 后才进入 full readiness.
- 已移除 API query index publication、export request、worker 和 standalone index bundle. API request 直接使用常驻内存 TypeDB.
- 已删除 VS Code LM tool 集成与实现. 可复用的 language-server API query core 继续通过独立 request handlers 保留.
- 已移除 local `auto` 变量推断的 lookup 阶段 fallback retry. `auto` member access 现在依赖声明期同步,直接把已解析的 initializer 类型写回 local variable 模型.
- VS Code Marketplace 的 pre-release 发布现在会在 `pre-release` 分支先用 `vsce package --pre-release` 生成 VSIX 再执行发布,确保包内 metadata 与 Marketplace 渠道一致.
- 激活策略现在使用 `onLanguage:angelscript` 和 `workspaceContains:**/*.as`,不再使用 `onDebug`.
- 启动索引现在只解析受支持的 Script 根目录(工作区根为 `Script` 或包含 `<workspace>/Script`)并仅扫描 `Script/**/*.as`;不受支持的布局会快速失败并跳过初始索引.
- Language client 现在通过 `initializationOptions` 下发 `scriptIgnorePatterns`,运行期 watched-file 通知和增量更新也仅处理已解析的 Script 根目录.
- 已移除脚本扫描的内置默认忽略规则;`UnrealAngelscript.scriptIgnorePatterns` 现在默认为空列表.
- `Angelscript API` 视图现在使用 `when: unrealAngelscript.apiPanelEnabled`;扩展激活前隐藏 activity 入口.
- 新增 structured language-server API query handlers,覆盖搜索、精确符号读取、owner members 和 class hierarchy. Query core 支持 source/kind/visibility 过滤、确定性去重与排序、offset 分页、歧义报告、constructor、accessor、继承成员和 mixin.
- `GetAPISearch` 现在仅在解析到 class scope 时将省略的 `includeInheritedFromScope` 自动开启,对 namespace/struct/enum 或未解析 scope 保持静默关闭.
- 搜索执行现在使用独立 language-server index,支持 smart/regex、ordered token-gap search、namespace/type scope、继承成员展开、最近 override 去重和 offset 分页.
- API panel 现在直接消费 `angelscript/getAPISearch` 结果,不再在 client 侧执行分页、regex 和二次排序.
- CI 发布流程已从 `beta/release` 迁移到 `pre-release/release`:仅发布到 VS Code Marketplace,VSIX 不限定 platform target,成功后强制更新 `pre-release`/`release` branch tags.

#### Breaking Changes
- v1 `.vscode/angelscript/unreal-cache.json` 不再读取或迁移. 集成方必须传入 typed initialization options 并使用 role-owned v2 cache contract.
- 已删除 `ue-resident`、`cli-direct` role 与 API query index contract,不保留 compatibility alias.
- VS Code LM tool 集成与实现已删除,不提供 compatibility layer.
- 旧 `angelscript/getTypeMembers` 和 `angelscript/getTypeHierarchy` request handlers 已由 `angelscript/getAPISymbolMembers` 和 `angelscript/getAPIClassHierarchy` 替代.
- `GetAPISearch` 现在会在解析到 class scope 且省略 `includeInheritedFromScope` 时自动展开 inherited methods/properties.

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
