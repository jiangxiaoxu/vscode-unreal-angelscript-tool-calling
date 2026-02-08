# 面相AI报告

## 目的
让 AI 在不扫描全仓的情况下快速理解系统做什么, 关键流程如何实现, 以及如何定位代码.
本版同时作为 `angelscript_` 工具契约与设计准则的长期追溯基线.

## 适用范围
- 面向 AI agent.
- 聚焦工具契约, 实现路径, 配置影响, 常见失败路径, 关键检索入口.

## 系统定位与阅读顺序
推荐阅读顺序:
1. `工具契约矩阵(长期基线)`
2. `路径策略设计准则`
3. `位置类工具JSON输出与preview准则`
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
| `angelscript_searchApi` | `labelQuery`, `searchIndex` | JSON envelope: `{ ok:true, data:{...} }` | JSON error: `{ ok:false, error:{...} }` | 无 `filePath` | 保持结构化, 不提供 `preview` |
| `angelscript_getTypeMembers` | `name`, 可选 `namespace/includeInherited/includeDocs/kinds` | JSON envelope: `{ ok:true, data:{ type, members } }` | JSON error | 无 `filePath` | 保持结构化, 不提供 `preview` |
| `angelscript_getClassHierarchy` | `name`, 可选深度/广度限制 | JSON envelope: `{ ok:true, data:{ root,supers,derivedByParent,sourceByClass,limits,truncated } }` | JSON error | `sourceByClass[*].filePath` 输出遵循工作区路径优先 | `source="as"` 条目包含 `preview` |
| `angelscript_findReferences` | `filePath`, `position(line,character)` | JSON envelope: `{ ok:true, data:{ total,references[] } }` | JSON error | 输入支持 absolute/workspace-relative, 输出路径工作区优先 | `references[*]` 包含 `preview` |
| `angelscript_resolveSymbolAtPosition` | `filePath`, `position(line,character)`, 可选 `includeDocumentation` | JSON envelope: `{ ok:true, data:{ symbol:{ kind,name,signature,definition?,doc? } } }` | JSON error | 输入支持 absolute/workspace-relative, 输出路径工作区优先 | `definition` 存在时包含 `preview` |

统一契约:
- 成功统一为 `{ ok:true, data:... }`.
- 失败统一为 `{ ok:false, error:{ code,message,retryable?,hint?,details? } }`.
- 仅行级定位结果提供 `preview` 字段.

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

## 位置类工具JSON输出与preview准则
适用范围:
- `angelscript_resolveSymbolAtPosition`.
- `angelscript_findReferences`.
- `angelscript_getClassHierarchy` 中 `source="as"` 条目.

统一规则:
- 成功返回 JSON envelope, 失败返回 JSON error.
- 行级字段旁提供 `preview: string`, 直接返回源码片段.
- `preview` 最多 20 行, 超出追加 `... (truncated)`.
- 源文件不可读取时 `preview` 固定为 `<source unavailable>`.

字段基线:
- `resolve`: `data.symbol.definition.preview`.
- `findReferences`: `data.references[*].preview`,且 `range` 保持 LSP 原始偏移(0-based).
- `getClassHierarchy`: `data.sourceByClass[*].preview`(仅 `source="as"`).
- `searchApi/getTypeMembers` 不包含 `preview`.

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
- `buildSourcePreviewSection`: 统一读取源码片段并生成 `preview`.
- `buildResolveSuccessData`: 组装 `resolve` 的 `data.symbol` JSON 结构.
- `buildFindReferencesItems`: 组装 `findReferences` 的 `references[]` 与 `preview`.
- `buildTypeHierarchyToolData`: 组装 `classHierarchy` 的 `data` 并给 `source="as"` 填充 `preview`.
- `runResolveSymbolAtPosition`: `resolve` tool 主执行入口.
- `runFindReferences`: `findReferences` tool 主执行入口.
- `runSearchApi/runGetTypeMembers/runGetTypeHierarchy`: 统一输出 `ok/data` envelope.

`extension/src/toolRegistry.ts`:
- 注册工具定义, 维护每个 tool 的 description/inputSchema 文案.
- LM/MCP 最终输出统一按 JSON 文本序列化.

`extension/src/apiRequests.ts`:
- 定义 tool 入参类型与结果类型.
- `ToolSuccess<T>/ToolFailure/ToolResult<T>` 是统一 envelope 类型基线.
- `GetTypeMembersLspResult` 与 `GetTypeMembersResult` 分离了 LSP 返回和 tool 对外契约.
- `GetTypeHierarchyLspResult` 与 `GetTypeHierarchyResult` 同上.

`language-server/src/symbols.ts`:
- `ResolveSymbolAtPosition`: language server 计算 symbol/definition/doc 的核心入口.
- `BuildDefinitionFromOffsets`: 定义行区间计算来源.

`language-server/src/api_docs.ts`:
- `getScriptClassSourceInfo`: class hierarchy 中 script class 的 `filePath/startLine/endLine` 来源.

## 验收与回归清单
功能验收:
- `bDrawDebugLadder` 场景中, `resolve.data.symbol.definition.preview` 应包含 `UPROPERTY` 与属性定义行.
- `findReferences.data.references[*]` 每项都包含 `filePath/startLine/endLine/range/preview`.
- `getClassHierarchy.data.sourceByClass[*]` 在 `source="as"` 时应包含 `preview`.
- 多 root + 歧义相对路径场景必须返回 `InvalidParams` 和候选路径.
- 工作区外文件路径输出应回退为 absolute path.

回归验收:
- `npm run compile` 通过.
- 5 个 `angelscript_` 工具成功都返回 `{ ok:true, data:... }`.
- 5 个 `angelscript_` 工具失败都返回 `{ ok:false, error:{...} }`.

## 兼容性与回滚策略
breaking 风险:
- `searchApi/getTypeMembers/getClassHierarchy` 成功字段从顶层迁移到 `data`.
- `resolve/findReferences` 成功输出从纯文本迁移为结构化 JSON.

回滚策略:
- 如调用方受影响过大, 可先回滚 envelope 改动,恢复原顶层成功字段.
- 如仅 `resolve/findReferences` 兼容性受阻, 可先恢复其文本输出,其余工具保持 JSON.
- 保留路径输入兼容(absolute + workspace-relative), 降低回滚损失.
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

