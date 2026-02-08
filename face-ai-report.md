# 面相AI报告

## 目的
让 AI 在不扫描全仓的情况下快速理解系统做什么, 关键流程如何实现, 以及如何定位代码.

## 适用范围
- 面向 AI agent.
- 聚焦实现路径, 配置影响, 常见失败路径, 关键检索入口.

## 系统定位与阅读顺序
推荐阅读顺序:
1. `工具契约矩阵(长期基线)`
2. `路径策略设计准则`
3. `位置类工具文本输出准则`
4. `实现映射与关键函数`
5. `验收与回归清单`

入口文件索引:
- `extension/src/toolRegistry.ts`
- `extension/src/toolShared.ts`
- `extension/src/apiRequests.ts`
- `language-server/src/symbols.ts`
- `language-server/src/api_docs.ts`

## 工具契约矩阵(长期基线)
| Tool | 输入关键字段 | 成功输出 | 失败输出 | 路径字段规则 | 兼容性提示 |
| --- | --- | --- | --- | --- | --- |
| `angelscript_searchApi` | `labelQuery`, `searchIndex` | JSON | JSON error | 无 `filePath` | 保持结构化, 不建议文本化 |
| `angelscript_getTypeMembers` | `name`, 可选 `namespace/includeInherited/includeDocs/kinds` | JSON | JSON error | 无 `filePath` | 保持结构化, 不建议文本化 |
| `angelscript_getClassHierarchy` | `name`, 可选深度/广度限制 | JSON | JSON error | `sourceByClass[*].filePath` 输出遵循工作区路径优先 | 保持结构化, 便于消费层遍历 |
| `angelscript_findReferences` | `filePath`, `position(line,character)` | 纯文本预览 | JSON error | 输入支持 absolute/workspace-relative, 输出路径工作区优先 | 已是位置类文本输出基线 |
| `angelscript_resolveSymbolAtPosition` | `filePath`, `position(line,character)`, 可选 `includeDocumentation` | 纯文本预览 | JSON error | 输入支持 absolute/workspace-relative, 输出路径工作区优先 | 成功 JSON -> 文本 已生效, 调用方需迁移 |

`resolve` 迁移状态:
- 当前状态(已实现): 成功文本, 失败 JSON.
- 目标状态(计划中): 无.
- 迁移影响: 依赖成功 JSON 结构(`ok/symbol/definition`)的调用方需要改为解析文本.

## 路径策略设计准则
输入路径准则:
- 支持 absolute path.
- 支持 workspace-relative path, 推荐 `rootName/...`.

输出路径准则:
- 优先输出工作区路径, 格式为 `rootName/relative/path`.
- 文件不在任一 workspace root 时, 输出 absolute path.
- 路径分隔符统一 `/`.

多 root 处理准则:
- 不允许静默选择 root.
- 无法唯一定位时返回 `InvalidParams` + `candidates`.
- 必要时给出 `hint`, 提示用户加 root 前缀.

## 位置类工具文本输出准则
适用范围:
- `angelscript_findReferences`(已执行).
- `angelscript_resolveSymbolAtPosition`(已执行).

统一规则:
- 成功返回纯文本.
- 失败返回 JSON error.
- 头部路径行使用 `//path:start-end`.
- 代码片段最多 20 行, 超出追加 `... (truncated)`.
- 源文件不可读取时使用 `<source unavailable>`.

建议的 `resolve` 成功文本结构:
1. `kind=<kind>  name=<name>  signature=<signature>`
2. `//<path>:<startLine>-<endLine>`
3. `/* hover/doc text */`(有文档时)
4. `definition snippet`

## Unreal 宏回溯准则
宏集合:
- `UCLASS`
- `UPROPERTY`
- `UFUNCTION`
- `UENUM`

回溯策略:
- 仅检查定义起始行的上一行.
- 若上一行命中 `U*` 宏, 将宏行视为展示起始行.
- 原定义结束行保持不变.

明确非目标:
- 不跨多行向上扫描.
- 不跳过注释或空行继续查找宏.

## 实现映射与关键函数
`extension/src/toolShared.ts`:
- `resolveWorkspaceRelativePathToAbsolute`: 解析 workspace-relative 输入路径.
- `resolveToolFilePathInput`: 统一处理输入路径并产出 file URI.
- `formatOutputFilePath`: 统一输出路径格式.
- `runResolveSymbolAtPosition`: `resolve` tool 主执行入口.
- `runFindReferences`: `findReferences` tool 主执行入口.
- `formatFindReferencesPreview`: 引用预览纯文本格式化.
- `normalizeTypeHierarchySourcePaths`: 统一 class hierarchy 的 `sourceByClass[*].filePath` 输出路径策略.

`extension/src/toolRegistry.ts`:
- 注册工具定义, 维护每个 tool 的 description/inputSchema 文案.

`extension/src/apiRequests.ts`:
- 定义 tool 入参类型与结果类型.
- `ResolveSymbolAtPositionResult` 对应 language server 协议层结构.

`language-server/src/symbols.ts`:
- `ResolveSymbolAtPosition`: language server 计算 symbol/definition/doc 的核心入口.
- `BuildDefinitionFromOffsets`: 定义行区间计算来源.

`language-server/src/api_docs.ts`:
- `getScriptClassSourceInfo`: class hierarchy 中 script class 的 `filePath/startLine/endLine` 来源.

## 验收与回归清单
功能验收:
- `bDrawDebugLadder` 场景中, `resolve` 文本结果应能包含 `UPROPERTY` 与属性定义行.
- 多 root + 歧义相对路径场景必须返回 `InvalidParams` 和候选路径.
- 工作区外文件路径输出应回退为 absolute path.

回归验收:
- `npm run compile` 通过.
- `angelscript_searchApi/getTypeMembers/getClassHierarchy` 继续返回成功 JSON.
- `angelscript_findReferences` 继续保持成功文本, 失败 JSON.

## 兼容性与回滚策略
breaking 风险:
- `resolve` 成功输出从 JSON 切换到文本后, 依赖旧 JSON 解析的调用方会失效.

回滚策略:
- 可先回滚 `resolve` 成功文本化, 恢复成功 JSON.
- 保留已完成的路径输入兼容(absolute + workspace-relative), 降低回滚损失.
- 同步更新 `README.md`, `package.json`, `CHANGELOG.md` 以反映回滚状态.

## 维护流程(强制)
每次涉及 tool 契约变更时, 必须同步更新:
- `face-ai-report.md`
- `README.md`
- `package.json` 中对应 tool 的 `modelDescription`/`inputSchema` 文案
- `CHANGELOG.md`

提交前检查清单:
- 契约描述是否在代码与文档中一致.
- 示例输入输出是否可复现.
- 验收命令是否通过(至少 `npm run compile`).
- breaking 影响是否写入 changelog.

## 待落地项
- 暂无.

